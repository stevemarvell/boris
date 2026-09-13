"""FastAPI application exposing the family tree over GraphQL."""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from strawberry.fastapi import GraphQLRouter

from api.schema import create_schema
from api.tree import FamilyTree

# The web app is deployed separately (Vercel), so it is always cross-origin.
# Anyone can deploy to vercel.app, so the regex is scoped to this project's
# own hostnames rather than the whole domain: the production alias
# (family-tree-flame-ten) and the family-tree-<hash>-<scope> shape Vercel
# gives preview deployments, both under family-tree-*.vercel.app. The GitHub
# Pages origin is spelled out in full rather than as *.github.io: the manual
# at /boris/manual/api/ calls this API from the browser, and every other
# GitHub user shares that domain.
ALLOWED_ORIGIN_REGEX = os.environ.get(
    "ALLOWED_ORIGIN_REGEX",
    r"https://family-tree-[a-z0-9-]+\.vercel\.app"
    r"|https://stevemarvell\.github\.io"
    r"|http://(localhost|127\.0\.0\.1):\d+",
)

# Gates the GraphQL IDE and introspection, both of which hand an unauthenticated
# caller the schema shape for free. Defaults to "production" -- the safe
# setting -- so a forgotten variable fails closed; set API_ENVIRONMENT=development
# (see CLAUDE.md's "Running it" section) to get both back locally. Documented
# in CLAUDE.md's deployment section too, since this is a Railway service
# variable rather than something set in this repository's own config files.
API_ENVIRONMENT = os.environ.get("API_ENVIRONMENT", "production")

# Read once at startup. The data is a file in the repository, so it only
# changes when a deployment does.
tree = FamilyTree.load()


def create_app(*, environment: str | None = None) -> FastAPI:
    """Build the app, wired for production or development.

    `environment` defaults to API_ENVIRONMENT so a plain `create_app()` gives
    the deployed behaviour; tests pass it explicitly to exercise both
    configurations in the same process.
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

    return app


app = create_app()
