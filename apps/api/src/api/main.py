"""FastAPI application exposing the family tree over GraphQL."""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from strawberry.fastapi import GraphQLRouter

from api.schema import schema
from api.tree import FamilyTree

# The web app is deployed separately (Vercel), so it is always cross-origin.
# Preview deployments get generated hostnames, hence the regex rather than a list.
ALLOWED_ORIGIN_REGEX = os.environ.get(
    "ALLOWED_ORIGIN_REGEX",
    r"https://.*\.vercel\.app|http://(localhost|127\.0\.0\.1):\d+",
)

# Read once at startup. The data is a file in the repository, so it only
# changes when a deployment does.
tree = FamilyTree.load()

app = FastAPI(title="family-tree-api")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["content-type"],
)

app.include_router(
    GraphQLRouter(schema, context_getter=lambda: {"tree": tree}),
    prefix="/graphql",
)


@app.get("/health")
def health() -> dict[str, bool | int]:
    return {"ok": True, "people": len(tree.people)}
