"""What the three tools return, as plain data.

Kept apart from `server.py` so the shapes can be tested without a transport,
and so the transport can be tested against shapes that are already known good.
Each function takes the `FamilyTree` it reads, and every list in the result is
one of that tree's derivations rather than anything assembled here.
"""

from typing import Any

from api.models import Person
from api.tree import FamilyTree

from family_mcp.relationships import relationship_between


def _ref(person: Person) -> dict[str, str]:
    """The short form used wherever a person appears inside another answer."""
    return {"id": person.id, "name": person.name}


def person_view(tree: FamilyTree, person_id: str) -> dict[str, Any]:
    """One person and the relationships derived for them.

    Every list is empty for someone who genuinely has none — `albert-shaw` has
    no parents and no siblings, `olivia-vance` no children — and that is a fact
    about the person, not a failed lookup. An unknown id raises instead, so the
    two can never be confused.

    Raises `api.tree.DataError` if the id is unknown.
    """
    person = tree.get(person_id)
    spouse = tree.spouse(person_id)
    return {
        "id": person.id,
        "name": person.name,
        "generation": tree.generation_of(person_id),
        "spouse": _ref(spouse) if spouse else None,
        "parents": [_ref(p) for p in tree.parents(person_id)],
        "children": [_ref(p) for p in tree.children(person_id)],
        "siblings": [_ref(p) for p in tree.siblings(person_id)],
        "grandparents": [_ref(p) for p in tree.grandparents(person_id)],
        "cousins": [_ref(p) for p in tree.cousins(person_id)],
    }


def search(tree: FamilyTree, query: str) -> list[dict[str, str]]:
    """Everyone whose name contains `query`, case-insensitively.

    Matches the name only — ids are for `get_person`, and a search that also
    matched them would answer "pike" differently from "Pike" for no reason a
    caller could see. Ordered by name, then id, the way the tree orders every
    other list.

    A blank query raises: it would otherwise match the whole tree, which reads
    like a search result and is not one.
    """
    fragment = query.strip().casefold()
    if not fragment:
        raise ValueError("query must not be blank; pass part of a name to search for")
    found = [p for p in tree.people.values() if fragment in p.name.casefold()]
    return [_ref(p) for p in sorted(found, key=lambda p: (p.name, p.id))]


def relationship_view(tree: FamilyTree, a: str, b: str) -> dict[str, Any]:
    """`a`'s relationship to `b`, with both people named.

    `relationship` is always one term from
    `family_mcp.relationships.RELATIONSHIP_TERMS`.

    Raises `api.tree.DataError` if either id is unknown.
    """
    return {
        "a": _ref(tree.get(a)),
        "b": _ref(tree.get(b)),
        "relationship": relationship_between(tree, a, b),
    }
