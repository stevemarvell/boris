"""Naming the relationship between two people, in one fixed vocabulary.

Every question this module asks is answered by `api.tree.FamilyTree`. It reads
`tree.siblings(...)`, `tree.grandparents(...)`, `tree.cousins(...)` and so on;
it never looks at `Person.parents` to work out a sibling for itself. The edge
cases that make those derivations awkward — half-siblings sharing one parent,
a married-in partner levelled to their spouse's generation — are already
handled there, and are handled here by not being handled here.
"""

from api.models import Person
from api.tree import FamilyTree

#: Every answer `relationship_between` can give. Closed on purpose: a client
#: can switch on this list and know it has covered every case.
RELATIONSHIP_TERMS: tuple[str, ...] = (
    "self",
    "spouse",
    "parent",
    "child",
    "sibling",
    "grandparent",
    "grandchild",
    "aunt-or-uncle",
    "niece-or-nephew",
    "cousin",
    "unrelated",
)


def _ids(people: list[Person]) -> set[str]:
    return {person.id for person in people}


def relationship_between(tree: FamilyTree, a: str, b: str) -> str:
    """How `a` is related to `b`, as one term from `RELATIONSHIP_TERMS`.

    The direction is "a is b's ___": if `a` is `b`'s mother, the answer is
    `parent`, and asking the other way round gives `child`.

    Precedence, where more than one term could apply, is by degree of kinship —
    the number of parent-child steps between the two people — with marriage
    ahead of blood and, at equal degree, the smaller generation gap first:

    | Term | Degree | Generations apart |
    | --- | --- | --- |
    | `self` | 0 | 0 |
    | `spouse` | — (marriage, not descent) | 0 |
    | `parent`, `child` | 1 | 1 |
    | `sibling` | 2 | 0 |
    | `grandparent`, `grandchild` | 2 | 2 |
    | `aunt-or-uncle`, `niece-or-nephew` | 3 | 1 |
    | `cousin` | 4 | 0 |

    So a tree where someone is both a sibling and a cousin reports `sibling`
    (`FamilyTree.cousins` already excludes siblings, so that particular pair
    cannot arise), and one where a person is both parent and half-sibling
    reports `parent`.

    `unrelated` means "no term in this vocabulary applies", which is wider than
    "no connection". It covers strangers, but also everyone the closed
    vocabulary has no word for: in-laws of every kind, a great-grandparent, a
    first cousin once removed. A client must not read it as "no relatives".

    Raises `api.tree.DataError` if either id is unknown.
    """
    tree.get(a)
    tree.get(b)

    if a == b:
        return "self"

    partner = tree.spouse(b)
    if partner is not None and partner.id == a:
        return "spouse"

    if a in _ids(tree.parents(b)):
        return "parent"
    if a in _ids(tree.children(b)):
        return "child"
    if a in _ids(tree.siblings(b)):
        return "sibling"
    if a in _ids(tree.grandparents(b)):
        return "grandparent"
    if b in _ids(tree.grandparents(a)):
        return "grandchild"
    if _is_sibling_of_a_parent(tree, a, b):
        return "aunt-or-uncle"
    if _is_sibling_of_a_parent(tree, b, a):
        return "niece-or-nephew"
    if a in _ids(tree.cousins(b)):
        return "cousin"
    return "unrelated"


def _is_sibling_of_a_parent(tree: FamilyTree, a: str, b: str) -> bool:
    """Is `a` a sibling of one of `b`'s parents?

    Composed from `FamilyTree.parents` and `FamilyTree.siblings` rather than
    from stored parent ids, so a half-sibling of a parent is an aunt or uncle
    here for the same reason they are a half-sibling there.
    """
    return any(a in _ids(tree.siblings(parent.id)) for parent in tree.parents(b))
