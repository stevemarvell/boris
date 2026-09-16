"""Security response headers for every response this service emits.

Why this exists at all: until the API manual moved into this image (#45) the
service emitted `application/json` and nothing else, and a JSON-only origin
needs none of these headers. It now serves an HTML document with a query
console at its own root, so the *class* of the origin changed -- and nothing in
that change made the transition visible. This file is that visibility.

The severity is low and worth stating plainly: the manual is static, built from
this repository, and contains no user input, so there is no injection path into
it today. These headers are a bound on what a future dynamic element could do,
not a fix for a live hole.

**The headers, and why each one.**

* `X-Content-Type-Options: nosniff` -- the mount at "/" serves whatever files
  are in `apps/api/manual/`, and a browser that sniffs a mistyped file into
  `text/html` executes it. Costs nothing.
* `Referrer-Policy: no-referrer` -- the manual links out to GitHub, Vercel and
  the deployed API. Nothing in this service's URLs is worth leaking to those
  hosts, and it has no analytics that wants a referrer back, so the strictest
  value is also the free one.
* `X-Frame-Options: DENY` **and** CSP `frame-ancestors 'none'` -- deliberately
  both, because they are not interchangeable. `frame-ancestors` is the one that
  counts: it is the modern control, it is what the issue asked for, and a
  browser that understands it ignores `X-Frame-Options` entirely. But it is CSP
  Level 2, so the legacy header is what answers a client too old to implement
  it. They say the same thing here, so the pair cannot contradict each other;
  if they ever diverge, `frame-ancestors` is the one to edit.

**Strict-Transport-Security is deliberately absent.** Railway's edge terminates
TLS and this service is never reached over plain HTTP, so the header would only
matter for a host this app does not control, on a vendor domain shared with
every other Railway deployment. Pinning HSTS onto `*.up.railway.app` from here
is not ours to do.

**The Content-Security-Policy, and what it honestly buys.**

The manual runs inline `<script>` and inline `<style>`, so the policy below
permits `'unsafe-inline'` for both. That is the arguable half, and it is worth
being exact about it: with `'unsafe-inline'` present, `script-src` stops being
an XSS defence. Extracting the manual's script and style to their own files is
what would earn a real `script-src`, and that is a large diff in a file this
change does not touch -- a follow-up, not a silent omission.

What the rest of the policy still buys, with the inline allowance granted:

* `default-src 'none'` with per-type allowances -- no external origin can be
  pulled into this page at all. An injected `<script src=https://evil/>` does
  not load even though an injected inline script would run.
* `connect-src 'self'` -- the console's fetch can reach this origin's /graphql
  and nowhere else, so data read out of the API cannot be posted elsewhere.
* `base-uri 'none'` -- no injected `<base>` can re-point every relative URL on
  the page.
* `form-action 'none'` -- nothing on this origin can submit a form anywhere.
* `frame-ancestors 'none'` -- the clickjacked "Run query" the issue describes.

**Development loosens it, production does not.** The GraphQL IDE only exists
when API_ENVIRONMENT=development (see api.main), and Strawberry's GraphiQL page
loads React, GraphiQL and its explorer plugin from unpkg.com. A policy strict
enough for production would leave a blank IDE, so the development policy adds
that one host -- and only that host, and only where the IDE's own markup asks
for it. `test_security_headers.py` reads Strawberry's shipped template and
asserts every external host in it is permitted, so an upgrade that moves the
IDE to a different CDN fails a test instead of failing in a browser.
"""

from collections.abc import Mapping

from fastapi import FastAPI
from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

# The policy that ships to production, as directives rather than one string, so
# the development variant can extend it by name instead of by string surgery.
BASE_CSP_DIRECTIVES: Mapping[str, tuple[str, ...]] = {
    "default-src": ("'none'",),
    # 'unsafe-inline' is the manual's inline <script>. See the module docstring:
    # this is the half of the policy that buys little, and the follow-up is to
    # extract the script rather than to keep widening this line.
    "script-src": ("'self'", "'unsafe-inline'"),
    "style-src": ("'self'", "'unsafe-inline'"),
    # The manual's two screenshots. data: is here for inline SVG icons, which
    # the page does not have today but which cost nothing to allow and are the
    # usual reason this line gets edited in a hurry later.
    "img-src": ("'self'", "data:"),
    # The console posts to /graphql on the origin it was loaded from -- that is
    # the whole point of serving the manual from the API rather than from
    # Vercel -- so 'self' is the complete list.
    "connect-src": ("'self'",),
    "font-src": ("'self'", "data:"),
    "base-uri": ("'none'",),
    "form-action": ("'none'",),
    "frame-ancestors": ("'none'",),
}

# Where Strawberry's GraphiQL template fetches React, GraphiQL and the explorer
# plugin from. Development only: the IDE is not served in production, so this
# host is not permitted there.
IDE_CDN = "https://unpkg.com"

# Exactly the directives the IDE's markup reaches across an origin for: its
# <script src>, its <link rel=stylesheet>, and whatever those stylesheets
# reference. connect-src is *not* extended -- the IDE talks to /graphql on this
# origin and nowhere else.
IDE_CSP_EXTRAS: Mapping[str, tuple[str, ...]] = {
    "script-src": (IDE_CDN,),
    "style-src": (IDE_CDN,),
    "img-src": (IDE_CDN,),
    "font-src": (IDE_CDN,),
}


def build_csp(*, is_development: bool) -> str:
    """Render the policy for this environment into a header value."""
    directives: dict[str, tuple[str, ...]] = dict(BASE_CSP_DIRECTIVES)
    if is_development:
        for directive, extra in IDE_CSP_EXTRAS.items():
            directives[directive] = directives[directive] + extra
    return "; ".join(f"{name} {' '.join(values)}" for name, values in directives.items())


def security_headers(*, is_development: bool) -> dict[str, str]:
    """The full set of headers to set, for the given environment."""
    return {
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "x-frame-options": "DENY",
        "content-security-policy": build_csp(is_development=is_development),
    }


class SecurityHeadersMiddleware:
    """Sets the headers on every response, whatever produced it.

    Written as raw ASGI rather than as a BaseHTTPMiddleware subclass for two
    reasons. It touches only the `http.response.start` message, so a streamed
    `FileResponse` off the manual's static mount is never buffered through it;
    and it applies to responses the app never generated a route for -- a 404
    from the router, the 429 the rate limiter returns itself, a CORS preflight
    answered by CORSMiddleware before anything downstream runs. "Installed and
    inert on the error path" is the failure this repository keeps hitting, so
    the tests assert the headers on each of those paths rather than asserting
    the middleware is in the stack.

    **Position matters, and it is the trap `api.limits` already documents.**
    `add_middleware` inserts at the *front* of the list, so the last middleware
    added is the outermost one, and only the outermost sees responses that the
    middleware inside it short-circuits. This one must therefore be added
    *after* the rate limiter and after CORS -- see `api.main.create_app`.

    One response is out of reach: Starlette's ServerErrorMiddleware sits
    outside every user middleware, so the bare "Internal Server Error" it
    returns for an unhandled exception carries none of these headers. It is
    `text/plain` with no attacker-controlled content, and putting anything
    outside ServerErrorMiddleware would mean not building the app with
    FastAPI's own constructor. Known, and left.

    Existing values are never overwritten: a response that sets its own
    Content-Security-Policy keeps it.
    """

    def __init__(self, app: ASGIApp, *, headers: Mapping[str, str]) -> None:
        self.app = app
        self.headers: tuple[tuple[str, str], ...] = tuple(headers.items())

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                response_headers = MutableHeaders(scope=message)
                for name, value in self.headers:
                    response_headers.setdefault(name, value)
            await send(message)

        await self.app(scope, receive, send_with_headers)


def install_security_headers(app: FastAPI, *, is_development: bool) -> dict[str, str]:
    """Add the middleware to `app` and return the headers it will set.

    Call this *last*, after every other `add_middleware`, so it ends up
    outermost. The headers come back so a caller can see what was installed
    without re-deriving the set.
    """
    headers = security_headers(is_development=is_development)
    app.add_middleware(SecurityHeadersMiddleware, headers=headers)
    return headers
