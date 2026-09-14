"""A small REST view of the family tree, alongside the GraphQL one.

Two endpoints:

    GET /person/{id}   one person, with the relationships derived for them
    GET /me            the same, for whoever is logged in

`/me` is the whole point of the pair. It resolves to a person and returns a
body byte-identical to that person's own URL, so `/me` and `/person/fred-shaw`
are the same resource reached two ways — one by name, one by identity.

**Why REST beside GraphQL rather than instead of it.** The GraphQL endpoint is
POST-only on purpose (`allow_queries_via_get=False` in api.main): a query is a
short string that can trigger an expensive resolution, so accepting one over
GET would turn an `<img src>` on any page into work this server has to do. It
also needs MAX_QUERY_DEPTH, because Person's relationship fields are mutually
recursive and each level costs roughly 3.5x.

These endpoints have neither problem. The response shape is fixed, so the cost
of a call is knowable before it arrives, which is what makes a GET safe here
and unsafe there. A fixed shape is also cacheable, which a POST is not.

**What is deliberately not in the body.** `grandparents`, `cousins` and
`descendants` are all derivable and all absent. `descendants` walks the whole
tree and `cousins` fans out through every parent's siblings' children; putting
them in the default representation would trade away the bounded cost that
justifies these endpoints existing. They belong on their own sub-resources if
anyone needs them, where the cost is something a caller opts into.
"""

import os

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from api.models import Person
from api.tree import FamilyTree

# The header standing in for a session.
#
# This API has no authentication and that is a recorded decision, not an
# oversight -- see docs/data-governance.md. So `/me` cannot ask who you are;
# it reads who you claim to be, which is enough to exercise the shape of the
# endpoint and is not enough for anything else. A caller can name any person
# in the tree and get their record, exactly as they could by asking for that
# person's own URL.
#
# It is written this way rather than hardcoding a person because a `/me` that
# silently answers for one fixed identity is not the endpoint anyone means,
# and because the absent-header case -- 401 -- is the behaviour that would
# survive a real login being wired in later.
IDENTITY_HEADER = "X-Person-Id"

# Overridable so a deployment can pin an identity without a header at all,
# which is what a demo wants and what a real session would replace.
DEFAULT_IDENTITY = os.environ.get("API_DEFAULT_IDENTITY")


def _ref(person: Person) -> dict[str, str]:
    """A pointer to another person: enough to name them and to fetch them."""
    return {"id": person.id, "name": person.name}


def person_body(tree: FamilyTree, person_id: str) -> dict[str, object]:
    """The representation both endpoints return.

    One function, so `/me` cannot drift from `/person/{id}` -- the two are the
    same resource, and a test asserts the bodies are byte-identical.
    """
    person = tree.people[person_id]
    spouse = tree.spouse(person_id)
    return {
        "id": person.id,
        "name": person.name,
        "generation": tree.generation_of(person_id),
        "spouse": _ref(spouse) if spouse else None,
        "parents": [_ref(p) for p in tree.parents(person_id)],
        "children": [_ref(p) for p in tree.children(person_id)],
        "siblings": [_ref(p) for p in tree.siblings(person_id)],
    }


def create_router(tree: FamilyTree) -> APIRouter:
    """Build the REST routes over `tree`.

    The tree is passed in rather than imported so a test can build a router
    over a fixture, the way create_app takes its environment.
    """
    router = APIRouter(tags=["people"])

    @router.get("/person/{person_id}")
    def read_person(person_id: str) -> JSONResponse:
        if person_id not in tree.people:
            raise HTTPException(status_code=404, detail=f"no person with id {person_id}")
        return JSONResponse(person_body(tree, person_id))

    @router.get("/me")
    def read_me(
        request: Request,
        x_person_id: str | None = Header(default=None),
    ) -> JSONResponse:
        """The logged-in person's own record.

        Never cacheable by a shared cache: the body depends on who is asking,
        so an intermediary that stored it would hand one caller another
        caller's answer. `/person/{id}` is the cacheable half of this pair;
        this is the half that is not, and it says so in the response.
        """
        identity = x_person_id or DEFAULT_IDENTITY
        if not identity:
            raise HTTPException(
                status_code=401,
                detail=f"not signed in; send {IDENTITY_HEADER} to say who you are",
            )
        if identity not in tree.people:
            raise HTTPException(
                status_code=404,
                detail=f"signed in as {identity}, who is not in this tree",
            )
        response = JSONResponse(person_body(tree, identity))
        response.headers["Cache-Control"] = "private, no-store"
        response.headers["Content-Location"] = str(
            request.url_for("read_person", person_id=identity)
        )
        return response

    return router
