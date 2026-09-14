"""The three tools this server exposes, independent of the MCP transport.

Each function takes the `FamilyTree` explicitly, so tests build one from an
in-memory list of `Person` (or load the real `data/family.json`) without
touching the MCP layer. `family_mcp.server` wires these to actual MCP tools
and translates `api.tree.DataError` into a client-visible tool error there —
this module raises `DataError` plainly, same as `FamilyTree` itself.
"""

from api.models import Person
from api.tree import FamilyTree

from family_mcp.relationships import relationship_between as _relationship_between


def _summary(person: Person) -> dict[str, str]:
    return {"id": person.id, "name": person.name}


def get_person(tree: FamilyTree, person_id: str) -> dict[str, object]:
    """One person, with every relationship `FamilyTree` derives for them.

    Raises `api.tree.DataError` if `person_id` is not in the tree.
    """
    person = tree.get(person_id)
    spouse = tree.spouse(person_id)
    return {
        "id": person.id,
        "name": person.name,
        "generation": tree.generation_of(person_id),
        "parents": [_summary(p) for p in tree.parents(person_id)],
        "spouse": _summary(spouse) if spouse is not None else None,
        "children": [_summary(p) for p in tree.children(person_id)],
        "siblings": [_summary(p) for p in tree.siblings(person_id)],
        "grandparents": [_summary(p) for p in tree.grandparents(person_id)],
        "cousins": [_summary(p) for p in tree.cousins(person_id)],
    }


def find_people(tree: FamilyTree, query: str) -> list[dict[str, str]]:
    """People whose name contains `query`, case-insensitively.

    An empty `query` matches everyone. No match is a normal, empty result —
    unlike an unknown id, a search fragment that matches nobody is not an
    error.
    """
    needle = query.lower()
    matches = [p for p in tree.people.values() if needle in p.name.lower()]
    matches.sort(key=lambda p: (p.name, p.id))
    return [_summary(p) for p in matches]


def relationship_between(tree: FamilyTree, a_id: str, b_id: str) -> str:
    """How `a_id` is related to `b_id`. See `family_mcp.relationships` for the
    fixed vocabulary and the precedence used to pick one term.

    Raises `api.tree.DataError` if either id is not in the tree.
    """
    return _relationship_between(tree, a_id, b_id)
