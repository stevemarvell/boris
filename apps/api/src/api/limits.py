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


def is_limited_path(path: str) -> bool:
    """Whether a request path is subject to the limit. See the module docstring."""
    return path == LIMITED_PREFIX or path.startswith(f"{LIMITED_PREFIX}/")


def client_key(request: Request) -> str:
    """Identify the caller to count against: one caller, one bucket.

    This is the part that was wrong first time round, and the reasoning below
    is measured against the deployed PR environment rather than derived from
    how proxies are supposed to behave. Railway's edge sends, verbatim:

        x-forwarded-for: 31.48.12.206, 152.233.29.4
        x-real-ip:       31.48.12.206
        socket peer:     100.64.0.8

    * The **leftmost** X-Forwarded-For hop is the caller. It was identical
      across 150 concurrent requests.
    * The **rightmost** hop is the edge node that handled the request, and
      Railway's edge is a *pool*: those 150 requests came through five of them
      (152.233.29.1 through .5). Keying on it -- which an earlier version of
      this file did, reasoning that the last hop is the one a caller cannot
      forge -- split one caller across five counters, each filling to its own
      120. A 120/minute limit passed 571 requests in twelve seconds.
    * X-Real-IP carries the same address as the leftmost hop, with nothing to
      parse. It is what this uses, with the leftmost hop as the fallback.
    * The socket peer is useless: it is Railway's internal mesh (100.64.0.0/10,
      fifteen distinct addresses across the same burst), not the caller.

    **The key is a header, and headers can be forged. That is the trade, and it
    is the standard one.** What makes it safe enough here is measured too: a
    request sent with `X-Real-IP: 9.9.9.9` arrived as `x-real-ip: 31.48.12.206`
    and one sent with `X-Forwarded-For: 9.9.9.9` arrived as
    `x-forwarded-for: 31.48.12.206, 152.233.29.5`. Railway's edge *replaces*
    both headers rather than appending to what the caller sent, so a caller
    cannot choose their own bucket while the only route in is that edge. If
    this app is ever exposed directly, or moved to a platform that passes an
    inbound X-Forwarded-For through, that stops being true and an attacker can
    mint a fresh budget per request by varying the header. The fallback to the
    socket peer is what makes local development (no proxy, no headers) still
    tell two clients apart.

    slowapi's own helpers are no use: get_remote_address is proxy-blind, and
    get_ipaddr looks for a header named "X_FORWARDED_FOR", with underscores,
    which no proxy sends.
    """
    real_ip = request.headers.get("x-real-ip")
    if real_ip and real_ip.strip():
        return real_ip.strip()

    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        hops = [hop.strip() for hop in forwarded.split(",") if hop.strip()]
        if hops:
            return hops[0]

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
    order.

    **The counters are one process's memory, so the real ceiling is the limit
    times the number of processes serving traffic.** Measured, not assumed: a
    burst of 150 concurrent requests at the deployed PR environment was
    answered by a single process (one pid, one per-process token), and the
    Dockerfile's CMD starts one uvicorn with no --workers, so today that
    multiplier is 1 and the ceiling is the configured limit. Scale the service
    to N replicas and it becomes N x the limit, silently -- nothing in this
    file can detect that. A limit that has to hold across replicas needs shared
    storage (slowapi takes a storage_uri; Redis is the usual answer), which is
    another service to run and is not worth it at this size.

    The counters are also lost on every deploy and every wake from
    sleepApplication, which is the other reason this is a ceiling on abuse
    rather than a quota.
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
    return limiter
