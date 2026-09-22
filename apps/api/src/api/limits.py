"""Per-client rate limiting for the GraphQL endpoint.

MAX_QUERY_DEPTH in api.schema bounds what a *single* query costs. It says
nothing about a thousand cheap ones. There are two layers, and the edge one is
the ceiling that holds:

* **The Vercel WAF rule** in apps/api/firewall.json -- the same limit on the
  same paths, counted per client IP at Vercel's edge, before any function
  instance runs. Vercel answers a burst with several instances at once, each
  with its own memory (#128), so only a counter outside the function can be
  one budget per caller. tests/test_firewall.py holds the file and this module
  to the same numbers; the smoke workflow's burst proves the rule is applied.
* **This module**, in process. Per instance on Vercel, so weaker than its
  number suggests, but it still refuses a single instance's worth, costs
  nothing, and is the only limit when the app runs anywhere else (local
  uvicorn, the e2e suite).

Two decisions are worth reading before changing anything:

**Only /graphql is limited.** The middleware below passes every other path
straight through, by whitelist rather than by exemption, because getting this
wrong is worse than not doing it at all:

* `/health` is the URL Playwright polls to decide the API is up, and a
  natural place for a future platform healthcheck to land. A 429 there reads
  as "the deployment is unhealthy" rather than "a caller is being refused",
  which is the wrong signal to give anything that acts on it. It must never
  be limited, so it is never even considered -- a whitelist cannot forget an
  exemption.
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
# Every path the limit applies to. Adding an endpoint means adding it here --
# the whitelist is the opt-in the module docstring describes, and a new route
# is unlimited until it appears in this tuple.
#
# /person and /me are cheap next to a deep GraphQL query, but cheap is not
# free: each one walks the whole tree to derive children and siblings, and the
# container has to wake before it can refuse anything. They share one budget
# with /graphql rather than getting their own, so a caller cannot double their
# allowance by switching surface.
LIMITED_PREFIXES = ("/graphql", "/person", "/me")


def is_limited_path(path: str) -> bool:
    """Whether a request path is subject to the limit. See the module docstring."""
    return any(path == prefix or path.startswith(f"{prefix}/") for prefix in LIMITED_PREFIXES)


def client_key(request: Request) -> str:
    """Identify the caller to count against: one caller, one bucket.

    This is the part that was wrong first time round, on Railway, and the
    reasoning below is measured against a real deployment rather than derived
    from how proxies are supposed to behave -- the earlier version of this
    docstring recorded the same discipline against Railway's edge, which
    turned out to append the pool node that handled a request as a second
    X-Forwarded-For hop and split one caller across five counters. The
    project moved to Vercel in #126, and Vercel's edge is not a pool in that
    sense, but the header shape it sends is different enough from Railway's
    that the old measurement does not carry over -- so this was re-measured
    against the live Vercel deployment rather than assumed to still be true.

    Vercel's own documentation
    (https://vercel.com/docs/headers/request-headers) is explicit that
    X-Forwarded-For "is the public IP address of the client that made the
    request", that Vercel "currently overwrite[s] the X-Forwarded-For header
    and do[es] not forward external IPs" -- i.e. a caller-supplied value is
    replaced, not appended to -- and that X-Real-IP "is identical to the
    X-Forwarded-For header". X-Vercel-Forwarded-For is documented as the same
    value again, kept distinct only because X-Forwarded-For could in
    principle be overwritten by a proxy placed in front of Vercel itself,
    which this deployment does not have.

    Measured against the deployed API
    (https://family-tree-api-stevemarvell-team.vercel.app) rather than taken
    on the documentation's word: five consecutive /graphql requests, the
    second and fourth carrying `X-Real-IP: 9.9.9.9` and
    `X-Forwarded-For: 9.9.9.9` respectively, returned X-RateLimit-Remaining of
    118, 117, 116, 115, 114 -- one shared, monotonically draining budget
    across every request, spoofed headers included. A caller that could pick
    its own bucket would have seen the spoofed requests come back with the
    limit's full remaining count instead.

    **The key is still a header, and headers can still be forged in
    principle.** What makes it safe enough here is that same measurement:
    Vercel's edge is the only route into this service, and it replaces both
    headers with the real client address regardless of what a caller sends.
    If this app is ever placed behind another proxy, or Vercel changes this
    behaviour, that stops being true and an attacker could mint a fresh
    budget per request by varying the header -- which is exactly the failure
    this file exists to keep re-measuring rather than re-assuming.

    Preference order: X-Vercel-Forwarded-For first, since Vercel's own docs
    name it as the one that cannot be affected by a proxy in front of Vercel;
    then X-Real-IP and X-Forwarded-For, identical in practice but kept as
    fallbacks for anything that only sets one; then the socket peer, which is
    what makes local development (no edge, no headers) still tell two clients
    apart. slowapi's own helpers are no use here: get_remote_address is
    proxy-blind, and get_ipaddr looks for a header named "X_FORWARDED_FOR",
    with underscores, which no proxy sends.
    """
    for header in ("x-vercel-forwarded-for", "x-real-ip", "x-forwarded-for"):
        value = request.headers.get(header)
        if not value:
            continue
        hops = [hop.strip() for hop in value.split(",") if hop.strip()]
        if hops:
            return hops[0]

    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def _one_budget() -> None:
    """A stable stand-in handler, so every limited path shares one counter.

    slowapi derives the bucket from this function's module and name. Passing
    the real route handler would give each endpoint its own budget; passing
    None disables the check under key_style="endpoint". A constant is what
    makes the limit per caller, which is what it claims to be.
    """


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
    default limit and no per-route ones, so there is no per-route limit for a
    handler to select.

    What the lookup's absence *did* cost, until it was noticed: with slowapi's
    default key_style of "url", the bucket included the request path, so every
    distinct URL got its own budget. One endpoint hid that completely. Adding
    /person/{id} would have handed a caller one budget per person. The limiter
    is now built with key_style="endpoint" and handed the _one_budget sentinel
    on every request, so the path drops out of the key and the limit is what it
    says it is: per caller.
    """

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        limiter: Limiter = request.app.state.limiter
        if not is_limited_path(request.url.path):
            return await call_next(request)

        # The edge rule in firewall.json matches path text, and this app
        # routes on the *decoded* path. A limited path that arrived
        # percent-encoded (/%67raphql) is refused outright, so it can never
        # reach a handler while missing the edge rule, however Vercel's WAF
        # treats encoding.
        raw_path = request.scope.get("raw_path")
        if raw_path is not None and raw_path.decode("latin-1") != request.url.path:
            return Response(status_code=404)

        if not limiter.enabled:
            return await call_next(request)

        error_response, inject_headers = await async_check_limits(
            limiter, request, _one_budget, request.app
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
    times the number of processes serving traffic -- and on Vercel that
    number is not 1.** This was true and reassuring on Railway: a burst of
    150 concurrent requests there was answered by a single process (one pid,
    one per-process token), because the Dockerfile's CMD started one uvicorn
    with no --workers. It does not carry over. Measured against the live
    Vercel deployment after #126's cutover: 200 concurrent /graphql requests
    (`xargs -P 50`) came back with X-RateLimit-Remaining values that were
    *not* one monotonically draining sequence -- the same remaining count
    (e.g. 0) came back dozens of times, and distinct X-Vercel-Id values showed
    several execution environments answering the burst in parallel, each
    counting independently. Vercel's Python runtime scales a function
    elastically under concurrent load rather than serialising requests
    through one process, so this in-memory limiter's real ceiling today is
    the configured limit times however many concurrent instances Vercel
    chooses to run -- a number this file cannot see or bound, and larger than
    1 under the exact kind of burst the limit exists to catch. Tracked as a
    follow-up rather than fixed here: a limit that has to hold under Vercel's
    concurrency needs shared storage (slowapi takes a storage_uri; Redis is
    the usual answer), which is another service to run and a bigger decision
    than a Railway-retirement cleanup should make on its own.

    The counters are also lost on every cold start, which is the other reason
    this was always a ceiling on abuse rather than a quota -- true on both
    platforms, and the least of what changed.
    """
    limiter = Limiter(
        key_func=client_key,
        default_limits=[limit or RATE_LIMIT],
        # One bucket per caller, not one per caller per URL.
        #
        # slowapi's default key_style is "url", which appends the request path
        # to the key. With a single endpoint that is invisible; with /person/{id}
        # it is a hole, because every id is a different path and therefore a
        # different budget -- 44 people meant 44 times the limit. Measured:
        # five requests to one path gave 200,200,200,429,429 and five requests
        # to five paths gave 200 throughout.
        #
        # "endpoint" keys on the handler's qualified name instead, and
        # GraphQLRateLimitMiddleware passes the same _one_budget sentinel for
        # every request, so the name is constant and the path drops out. Note
        # that this style with a *None* handler disables limiting entirely --
        # _endpoint_key would be "" and _check_request_limit returns early --
        # which is why the sentinel is not optional.
        key_style="endpoint",
        # Tell a well-behaved client what its budget is, and how long to wait,
        # instead of making it guess from a bare 429.
        headers_enabled=True,
        retry_after="delta-seconds",
    )
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_middleware(GraphQLRateLimitMiddleware)
    return limiter
