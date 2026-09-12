"""GraphQL schema.

Relationship fields resolve through `FamilyTree`, so nothing here reads a
stored sibling or child list — there is none to read.
"""

import strawberry
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


schema = strawberry.Schema(query=Query)
