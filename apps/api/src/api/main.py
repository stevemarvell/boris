"""FastAPI application exposing the family tree over GraphQL."""

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from strawberry.fastapi import GraphQLRouter

from api.limits import install_rate_limiting
from api.rest import create_router
from api.schema import create_schema
from api.security_headers import install_security_headers
from api.tree import FamilyTree

# The web app is deployed separately (Vercel), so it is always cross-origin.
# Anyone can deploy to vercel.app, so the regex is scoped to this project's
# own hostnames rather than the whole domain: the production alias
# (family-tree-web-eta) and the family-tree-web-<hash>-<scope> shape Vercel
# gives preview deployments, both under family-tree-web-*.vercel.app.
#
# There is no GitHub Pages origin here. The API manual used to be served from
# stevemarvell.github.io and called this API from the browser, which needed an
# allowance; it is now served by this app itself (see MANUAL_DIR below), so it
# is same-origin and CORS does not enter into it. A shared domain that nothing
# needs is an allowance worth deleting.
ALLOWED_ORIGIN_REGEX = os.environ.get(
    "ALLOWED_ORIGIN_REGEX",
    r"https://family-tree-[a-z0-9-]+\.vercel\.app"
    r"|http://(localhost|127\.0\.0\.1):\d+",
)

# Gates the GraphQL IDE and introspection, both of which hand an unauthenticated
# caller the schema shape for free. Defaults to "production" -- the safe
# setting -- so a forgotten variable fails closed; set API_ENVIRONMENT=development
# (see CLAUDE.md's "Running it" section) to get both back locally. Documented
# in CLAUDE.md's deployment section too, since this is a Vercel project
# environment variable rather than something set in this repository's own
# config files.
API_ENVIRONMENT = os.environ.get("API_ENVIRONMENT", "production")

# The commit this deployment was built from, reported by /health so that a
# caller can tell a current deployment from a stale one.
#
# This exists because of the failure recorded in issue #50: back when the API
# deployed to Railway, railway.json's watchPatterns listed only apps/api/**,
# while the Dockerfile also copied data/ and manual/api/, so a commit changing
# only the family tree or only the manual never triggered a rebuild. Nothing
# reported it -- verify was green, the deploy was green because there was no
# deploy, and smoke passed because it asserted the manual was *present* rather
# than *current*.
#
# #126 retired Railway once the API had actually cut over to Vercel, whose
# own build (apps/api/pyproject.toml's [tool.vercel] entrypoint) redeploys
# from a push the same way the web project already did, so there is no
# separate watch-pattern list to drift. This still closes the detection half:
# smoke compares this value against the commit it is running for, so a
# deployment that silently did not happen fails a check instead of going
# unnoticed. Vercel's Python runtime exposes VERCEL_GIT_COMMIT_SHA to the
# function at runtime, the same as every other runtime it supports; it is
# absent locally and in the container tests, where None is the honest answer.
DEPLOYED_COMMIT = os.environ.get("VERCEL_GIT_COMMIT_SHA")


def default_manual_path() -> Path | None:
    """Locate apps/api/manual by walking up from this module, as the tree
    loader locates its data.

    Works unchanged in the repository and in the container. apps/api is a
    self-contained Vercel project now (#126), so the manual lives inside it
    -- at apps/api/manual, not repo-root manual/api -- and this walk stops
    one directory higher than it used to. API_MANUAL_DIR overrides it.

    Returns None when there is no manual to serve. The manual is documentation:
    a deployment that somehow lacks it should still answer GraphQL rather than
    refuse to start. The smoke workflow fetches it after every merge, so a
    build that drops it fails there, loudly, instead of quietly.
    """
    override = os.environ.get("API_MANUAL_DIR")
    if override:
        return Path(override)
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "manual"
        if (candidate / "index.html").exists():
            return candidate
    return None


def _without_regions(html: str, start: str, end: str) -> str:
    """Drop every `start`...`end` region, markers included.

    An unterminated region runs to the end of the document. That is the
    fail-closed reading: a mistyped marker loses documentation, which the
    tests and the smoke workflow both notice, rather than leaking the half
    that was meant to be dropped -- or refusing to start over a typo in HTML.
    """
    kept: list[str] = []
    rest = html
    while True:
        before, marker, after = rest.partition(start)
        kept.append(before)
        if not marker:
            return "".join(kept)
        _, _, rest = after.partition(end)


def render_manual(html: str, is_development: bool) -> str:
    """Serve the half of the manual that belongs in this environment.

    The manual carries both: the interactive console between `console:*`
    markers, and the note that stands in for it between `no-console:*` ones.
    Exactly one is dropped here, so what production serves does not contain
    the console -- not a hidden one, not a disabled one, none.

    Gated on the same API_ENVIRONMENT as the GraphQL IDE and introspection,
    for the same reason and with the same default. A deployment that serves
    the data should not also host an unauthenticated console for querying it.

    Consequence worth knowing: API_ENVIRONMENT is not set on the Vercel
    project at all, so it reads "production" on preview deployments as well,
    and their manuals lose the console too -- which is most of what putting
    the manual on the API bought. The fix is one project environment
    variable, API_ENVIRONMENT=development (scoped to Preview), on the Vercel
    project; note that it also turns on GraphiQL and introspection there,
    which is fine on invented data in a throwaway environment and is not fine
    on production.

    A manual with neither marker -- a stub, a different document -- is
    returned unchanged.
    """
    dropped = "no-console" if is_development else "console"
    return _without_regions(html, f"<!-- {dropped}:start -->", f"<!-- {dropped}:end -->")


# Read once at startup. The data is a file in the repository, so it only
# changes when a deployment does.
tree = FamilyTree.load()


def create_app(*, environment: str | None = None, manual: Path | None = None) -> FastAPI:
    """Build the app, wired for production or development.

    `environment` defaults to API_ENVIRONMENT so a plain `create_app()` gives
    the deployed behaviour; tests pass it explicitly to exercise both
    configurations in the same process. `manual` likewise defaults to the
    manual that ships in the image.
    """
    is_development = (environment or API_ENVIRONMENT) == "development"

    # Swagger UI, ReDoc and the OpenAPI document are gated on the same
    # API_ENVIRONMENT as the GraphiQL IDE, introspection and the manual's query
    # console, for the same reason: /docs is an interactive console with a
    # "Try it out" button, unauthenticated, against live data, and
    # openapi.json publishes the parameters and response schemas of every
    # route -- precisely what DisableIntrospection withholds on the GraphQL
    # side. FastAPI's defaults turn all three on, so this was open not by a
    # decision but by nobody writing a line; passing None in production is
    # that line. The REST view added /person/{id} and /me, so the document now
    # describes real endpoints rather than /graphql and /health alone.
    app = FastAPI(
        title="family-tree-api",
        docs_url="/docs" if is_development else None,
        redoc_url="/redoc" if is_development else None,
        openapi_url="/openapi.json" if is_development else None,
    )

    # Rate limiting on /graphql -- and only there; api.limits explains why
    # /health and the manual are left alone.
    #
    # Added *before* CORS, which puts it inside it: add_middleware inserts at
    # the front of the stack, so the last one added is the outermost. CORS has
    # to stay outside, or a 429 would reach a browser without the header that
    # lets it read the body, and a preflight would spend a client's budget
    # instead of being answered by CORSMiddleware before the limiter sees it.
    install_rate_limiting(app)

    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=ALLOWED_ORIGIN_REGEX,
        allow_methods=["GET", "POST", "OPTIONS"],
        # x-person-id is what /me reads to decide who is asking (see api.rest).
        # Without it here, a browser's preflight refuses the header and /me is
        # reachable only from curl. It is admitted as an ordinary header, not a
        # credential: allow_credentials stays off, nothing is a secret, and
        # naming yourself gets you a record any caller could fetch by id
        # anyway. Real authentication would change that, and would mean
        # revisiting this block properly -- the consequence docs/data-governance.md
        # records against the decision not to have any.
        allow_headers=["content-type", "x-person-id"],
        # Which *response* headers JavaScript is allowed to read. Without this
        # a cross-origin caller sees only the seven CORS-safelisted names
        # (Cache-Control, Content-Language, Content-Length, Content-Type,
        # Expires, Last-Modified, Pragma); everything else is sent by the
        # server, received by the browser, and stripped before fetch() hands
        # the Response to the page. The web app is always cross-origin, so
        # "sent" and "readable" are different questions here and only the
        # second one matters.
        #
        # Three features depended on the difference and all three were inert
        # in production (issue #89):
        #
        # * Retry-After -- apps/web/src/api.ts reads it off a 429 to decide how
        #   long to wait. It read null, every time, and fell back to a guess.
        # * Content-Location -- set by /me (see api.rest) to name the identical
        #   /person/{id} resource. Unreadable, so unusable.
        # * X-RateLimit-* -- api.limits sets headers_enabled=True to "tell a
        #   well-behaved client what its budget is". Invisible to the only
        #   client there is.
        #
        # Cache-Control survived because it is safelisted, which is luck.
        #
        # curl has no CORS and TestClient has no CORS, so neither can tell a
        # readable header from a stripped one. The check that can is
        # apps/web/e2e/cors-expose-headers.spec.ts, which reads Retry-After off
        # a real cross-origin 429 in a real browser.
        expose_headers=[
            "Retry-After",
            "Content-Location",
            "X-RateLimit-Limit",
            "X-RateLimit-Remaining",
            "X-RateLimit-Reset",
        ],
    )

    # Added last, which makes it the outermost middleware -- the same ordering
    # trap as above, used the other way round. Only the outermost sees the
    # responses the layers inside it return without calling downstream: the
    # limiter's 429 and CORSMiddleware's preflight answer. Anything registered
    # after this line would sit outside it and its responses would go out bare.
    #
    # api.security_headers explains each header, and records the CSP decision:
    # the manual's inline script is permitted rather than pretended away.
    install_security_headers(app, is_development=is_development)

    app.include_router(
        GraphQLRouter(
            create_schema(disable_introspection=not is_development),
            context_getter=lambda: {"tree": tree},
            # No IDE in production: it is a public, unauthenticated console
            # pointed at real data. Development keeps the default IDE.
            graphql_ide="graphiql" if is_development else None,
            # A GraphQL query is a small string that can trigger an expensive
            # resolution -- see MAX_QUERY_DEPTH in api.schema -- so accepting
            # it via GET turns an <img src> on any page into a request the
            # server has to execute. Always off, in both environments.
            allow_queries_via_get=False,
        ),
        prefix="/graphql",
    )

    @app.get("/health")
    def health() -> dict[str, bool | int | str | None]:
        return {"ok": True, "people": len(tree.people), "commit": DEPLOYED_COMMIT}

    # The REST view: /person/{id} and /me. Registered before the manual mount
    # for the same reason /graphql and /health are -- the mount at "/" matches
    # everything, and routes are tried in the order they were added.
    app.include_router(create_router(tree))

    # The API's own reference manual, served from the root of this service.
    #
    # It used to live on GitHub Pages, which a private repository does not get
    # without a paid plan. Shipping it inside the image is better than moving
    # it to Vercel anyway: the manual's "try it" console now calls /graphql on
    # the origin it was loaded from, so a pull request environment's manual
    # exercises that pull request's API instead of production, and the CORS
    # allowance it needed disappears.
    #
    # The manual's console is gated the same way the IDE above is, and for the
    # same reason: it is an unauthenticated GraphQL console, and serving it
    # from the host that serves the data is an invitation. See render_manual().
    #
    # Mounted last, and last on purpose: a mount at "/" matches everything, so
    # it must come after /graphql and /health, which are matched in the order
    # they were registered.
    directory = manual if manual is not None else default_manual_path()
    if directory is not None:
        index = directory / "index.html"
        if index.exists():
            # The one document that varies is served by a route; everything
            # else -- the screenshots -- still comes off the static mount
            # below, untouched.
            #
            # Why this rather than the alternatives:
            #
            # - Two files, one per environment, would duplicate 1,400 lines of
            #   manual and let the halves drift. The markers keep both versions
            #   of the "Try it" section in one file, next to each other.
            # - Hiding the console with JavaScript would still ship it: the
            #   markup, the endpoint and the run logic would all be in the page
            #   for anyone who opens the source. The point is not to hide the
            #   button, it is not to serve it.
            # - Asking an endpoint for the environment would mean the page
            #   renders, then changes -- and would put the gate on the client,
            #   which is the wrong side of it.
            #
            # Rendered once, at startup, because the file only changes when a
            # deployment does -- the same reasoning as loading the tree once.
            page = render_manual(index.read_text(encoding="utf-8"), is_development)

            @app.get("/", response_class=HTMLResponse, include_in_schema=False)
            @app.get("/index.html", response_class=HTMLResponse, include_in_schema=False)
            def manual_page() -> HTMLResponse:
                return HTMLResponse(page)

        app.mount("/", StaticFiles(directory=directory, html=True), name="manual")

    return app


app = create_app()
