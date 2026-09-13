"""GraphQL schema.

Relationship fields resolve through `FamilyTree`, so nothing here reads a
stored sibling or child list — there is none to read.
"""

from collections.abc import Callable

import strawberry
from strawberry.extensions import DisableIntrospection, QueryDepthLimiter, SchemaExtension
from strawberry.types import Info

from api.tree import FamilyTree


def _tree(info: Info) -> FamilyTree:
    return info.context["tree"]


@strawberry.type
class Person:
    id: strawberry.ID
    name: str

    @strawberry.field
    def parents(self, info: Info) -> list["Person"]:
        return [_person(p) for p in _tree(info).parents(self.id)]

    @strawberry.field
    def spouse(self, info: Info) -> "Person | None":
        partner = _tree(info).spouse(self.id)
        return _person(partner) if partner else None

    @strawberry.field
    def children(self, info: Info) -> list["Person"]:
        return [_person(p) for p in _tree(info).children(self.id)]

    @strawberry.field
    def siblings(self, info: Info) -> list["Person"]:
        return [_person(p) for p in _tree(info).siblings(self.id)]

    @strawberry.field
    def grandparents(self, info: Info) -> list["Person"]:
        return [_person(p) for p in _tree(info).grandparents(self.id)]

    @strawberry.field
    def cousins(self, info: Info) -> list["Person"]:
        return [_person(p) for p in _tree(info).cousins(self.id)]

    @strawberry.field
    def descendants(self, info: Info) -> list["Person"]:
        return [_person(p) for p in _tree(info).descendants(self.id)]

    @strawberry.field
    def generation(self, info: Info) -> int:
        return _tree(info).generation_of(self.id)


def _person(person: object) -> Person:
    return Person(id=strawberry.ID(person.id), name=person.name)  # type: ignore[attr-defined]


@strawberry.type
class Generation:
    depth: int
    people: list[Person]


@strawberry.type
class Query:
    @strawberry.field
    def status(self) -> str:
        """Liveness probe reachable through GraphQL as well as REST."""
        return "ok"

    @strawberry.field
    def people(self, info: Info) -> list[Person]:
        return [_person(p) for p in _tree(info).people.values()]

    @strawberry.field
    def person(self, info: Info, id: strawberry.ID) -> Person | None:
        tree = _tree(info)
        found = tree.people.get(str(id))
        return _person(found) if found else None

    @strawberry.field
    def generations(self, info: Info) -> list[Generation]:
        """The whole tree, oldest generation first. This is the MVP view."""
        return [
            Generation(depth=depth, people=[_person(p) for p in group])
            for depth, group in enumerate(_tree(info).generations())
        ]


# Person's relationship fields are mutually recursive (cousins calls siblings
# per parent and children per aunt/uncle, siblings and grandparents fan out
# again one level down), so nesting them costs roughly 3.5x per extra level.
# A security review measured `{ people { cousins^7 { name } } }` -- depth 8
# by this limiter's count, since it counts fields-with-a-subselection from the
# root and a leaf field like `name` adds no level -- at 3.1 CPU-seconds and
# 2.2 MB against the 44-person tree in data/family.json, rising to 23.7s at
# depth 10. The deepest query the app or the manual ever send is depth 3 (the
# GENERATIONS query in apps/web/src/api.ts: generations -> people -> spouse
# { name }). Depth 6 leaves that query more than double the room to grow: the
# worst case it still admits, `{ people { cousins^5 { name } } }`, ran in
# 0.14s against the same data when measured here, against 3.1s at depth 8 --
# comfortably clear of where the exponential blow-up starts to bite.
MAX_QUERY_DEPTH = 6


def create_schema(*, disable_introspection: bool) -> strawberry.Schema:
    """Build the schema, with introspection off for anything internet-facing.

    Introspection hands out the exact shape of `Person`'s recursive fields
    for free -- the information an attacker needs to build the queries
    above -- so `api.main` disables it whenever the app is not explicitly
    running in development.
    """
    # Factories, not instances: strawberry constructs a fresh extension per
    # request from these, which is what it now expects (passing an instance
    # is deprecated).
    extensions: list[Callable[[], SchemaExtension]] = [
        lambda: QueryDepthLimiter(max_depth=MAX_QUERY_DEPTH)
    ]
    if disable_introspection:
        extensions.append(DisableIntrospection)
    return strawberry.Schema(query=Query, extensions=extensions)
