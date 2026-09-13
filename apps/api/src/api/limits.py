"""Per-client rate limiting for the GraphQL endpoint.

MAX_QUERY_DEPTH in api.schema bounds what a *single* query costs. It says
nothing about a thousand cheap ones, and this service is one Railway instance
with no WAF in front of it, so the only place a burst can be refused is here.

Two decisions are worth reading before changing anything:

**Only /graphql is limited.** The middleware below passes every other path
straight through, by whitelist rather than by exemption, because getting this
wrong is worse than not doing it at all:

* `/health` is Railway's healthcheck path (see railway.json) *and* the URL
  Playwright polls to decide the API is up. A 429 there is read as "the
  deployment is unhealthy": Railway would restart the container, and restarts
  make the burst worse. It must never be limited, so it is never even
  considered -- a whitelist cannot forget an exemption.
* The manual mounted at "/" is StaticFiles: bytes off disk, no tree walk, and
  one page load is a handful of requests. Limiting it would spend the budget a
  reader needs on files that cost nothing to serve, and the thing worth
  protecting is the "Run query" button, not the page around it. That button
  posts to /graphql, which *is* limited.

Anything expensive added later has to opt in here, deliberately.

**The limit is a service variable, like API_ENVIRONMENT.** API_RATE_LIMIT is
read once at import and defaults to a real limit, so a deployment where nobody
set the variable is still protected -- it fails closed rather than open.
"""

import os
import uuid

from fastapi import FastAPI
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import async_check_limits
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

# Requests per client per window, in the `limits` string format
# ("120/minute", "5/second", "1000/hour", several separated by ";").
#
# 120/minute is roughly two queries a second sustained from one address. The
# app itself sends two queries per page load and the manual's console sends one
# per click, so a person cannot reach it by hand; a script holding the button
# down reaches it in seconds. The deepest query the depth limit still allows
# costs ~0.14s of CPU, so this caps one client at about a fifth of the single
# instance rather than all of it.
#
# The value is deliberately generous rather than tight: this is one process
# with in-memory counters, so the limit resets on every deploy and on every
# wake from sleepApplication. It is a ceiling on abuse, not a quota.
DEFAULT_RATE_LIMIT = "120/minute"

RATE_LIMIT = os.environ.get("API_RATE_LIMIT", DEFAULT_RATE_LIMIT)

# The prefix the GraphQL router is mounted at in api.main.
LIMITED_PREFIX = "/graphql"

# TEMPORARY DIAGNOSTIC -- deleted before this branch merges. Distinct per
# process, so a burst against the probe below says how many processes answer.
PROCESS_TOKEN = uuid.uuid4().hex[:8]


def is_limited_path(path: str) -> bool:
    """Whether a request path is subject to the limit. See the module docstring."""
    return path == LIMITED_PREFIX or path.startswith(f"{LIMITED_PREFIX}/")


def client_key(request: Request) -> str:
    """Identify the caller to count against.

    Railway terminates TLS at its edge, so `request.client.host` is the proxy
    for every request that arrives in production: counting by it would put the
    whole internet in one bucket and let one abuser lock out everybody.
    X-Forwarded-For is what carries the real address.

    The *rightmost* entry is used, not the leftmost. A proxy appends the
    address it received the connection from, so with Railway's edge in front
    the last entry is the one Railway observed and the only one a caller
    cannot choose. A caller who sends their own X-Forwarded-For only adds
    entries to the left of it, which are ignored.

    slowapi ships get_remote_address (proxy-blind) and get_ipaddr (which looks
    for a header named "X_FORWARDED_FOR", with underscores, and so never
    matches a real one). Neither is right here.

    The failure mode to watch for: if the platform in front of this ever stops
    sending the header, every caller lands in the same bucket and the first 120
    requests a minute lock out everyone else. It shows up as 429s nobody can
    explain, on a service nobody is attacking.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        hops = [hop.strip() for hop in forwarded.split(",") if hop.strip()]
        if hops:
            return hops[-1]
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


class GraphQLRateLimitMiddleware(BaseHTTPMiddleware):
    """Applies the limiter to the paths in is_limited_path, and to nothing else.

    This is slowapi's own SlowAPIMiddleware.dispatch with two changes, and the
    second one is not cosmetic:

    1. Paths outside is_limited_path go straight through.
    2. The limits are checked against the request *path*, with no route handler
       looked up.

    slowapi finds the route handler for the request and skips any request whose
    handler it cannot find. This version of FastAPI keeps an included router
    nested in the app's route table as a `_IncludedRouter` rather than
    flattening its routes into it, and that object has no `.endpoint`, so
    slowapi's lookup returns None for every /graphql request and exempts the
    lot. Installed, running, counting nothing -- exactly the shape of failure
    this project keeps hitting, which is why the tests assert a 429 arrives
    rather than asserting the middleware is in the stack.

    Nothing is lost by dropping the lookup: the limiter is configured with a
    default limit and no per-route ones, and its default key style is the URL,
    so the path is what it would have counted against anyway.
    """

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        limiter: Limiter = request.app.state.limiter
        if not limiter.enabled or not is_limited_path(request.url.path):
            return await call_next(request)

        error_response, inject_headers = await async_check_limits(
            limiter, request, None, request.app
        )
        if error_response is not None:
            return error_response

        response = await call_next(request)
        if inject_headers:
            # slowapi has no public API for this; its own middleware reaches
            # for the same method.
            response = limiter._inject_headers(response, request.state.view_rate_limit)
        return response


def install_rate_limiting(app: FastAPI, *, limit: str | None = None) -> Limiter:
    """Wire a limiter onto `app` and return it.

    `limit` defaults to the module-level RATE_LIMIT rather than being baked in
    at import, so tests can build an app with a limit small enough to cross.

    The limiter is created per app: two apps in one process (as the tests
    build) count independently, which is what makes them able to run in any
    order. In the deployment there is exactly one app and one process, so the
    counters are that process's memory -- and they are lost when it sleeps.
    """
    limiter = Limiter(
        key_func=client_key,
        default_limits=[limit or RATE_LIMIT],
        # Tell a well-behaved client what its budget is, and how long to wait,
        # instead of making it guess from a bare 429.
        headers_enabled=True,
        retry_after="delta-seconds",
    )
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_middleware(GraphQLRateLimitMiddleware)

    # TEMPORARY DIAGNOSTIC -- deleted before this branch merges.
    @app.get("/__ratelimit-probe")
    def probe(request: Request) -> dict:
        return {
            "process": PROCESS_TOKEN,
            "pid": os.getpid(),
            "socket": request.client.host if request.client else None,
            "key": client_key(request),
            "headers": dict(request.headers),
        }

    return limiter
