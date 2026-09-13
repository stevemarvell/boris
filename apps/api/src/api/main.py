"""FastAPI application exposing the family tree over GraphQL."""

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from strawberry.fastapi import GraphQLRouter

from api.schema import create_schema
from api.tree import FamilyTree

# The web app is deployed separately (Vercel), so it is always cross-origin.
# Anyone can deploy to vercel.app, so the regex is scoped to this project's
# own hostnames rather than the whole domain: the production alias
# (family-tree-flame-ten) and the family-tree-<hash>-<scope> shape Vercel
# gives preview deployments, both under family-tree-*.vercel.app.
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
# in CLAUDE.md's deployment section too, since this is a Railway service
# variable rather than something set in this repository's own config files.
API_ENVIRONMENT = os.environ.get("API_ENVIRONMENT", "production")


def default_manual_path() -> Path | None:
    """Locate manual/api by walking up from this module, as the tree loader does.

    Works unchanged in the repository and in the container, where the manual is
    copied to /app/manual/api. API_MANUAL_DIR overrides it.

    Returns None when there is no manual to serve. The manual is documentation:
    a deployment that somehow lacks it should still answer GraphQL rather than
    refuse to start. The smoke workflow fetches it after every merge, so a
    build that drops it fails there, loudly, instead of quietly.
    """
    override = os.environ.get("API_MANUAL_DIR")
    if override:
        return Path(override)
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "manual" / "api"
        if (candidate / "index.html").exists():
            return candidate
    return None


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

    app = FastAPI(title="family-tree-api")

    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=ALLOWED_ORIGIN_REGEX,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["content-type"],
    )

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
    def health() -> dict[str, bool | int]:
        return {"ok": True, "people": len(tree.people)}

    # The API's own reference manual, served from the root of this service.
    #
    # It used to live on GitHub Pages, which a private repository does not get
    # without a paid plan. Shipping it inside the image is better than moving
    # it to Vercel anyway: the manual's "try it" console now calls /graphql on
    # the origin it was loaded from, so a pull request environment's manual
    # exercises that pull request's API instead of production, and the CORS
    # allowance it needed disappears.
    #
    # Mounted last, and last on purpose: a mount at "/" matches everything, so
    # it must come after /graphql and /health, which are matched in the order
    # they were registered.
    directory = manual if manual is not None else default_manual_path()
    if directory is not None:
        app.mount("/", StaticFiles(directory=directory, html=True), name="manual")

    return app


app = create_app()
