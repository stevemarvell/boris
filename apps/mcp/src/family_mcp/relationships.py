"""How one person relates to another, expressed as a single fixed term.

`FamilyTree` (in `apps/api/src/api/tree.py`) already derives parents, spouse,
children, siblings, grandparents, and cousins from the two facts a person
record stores (`parents`, `spouse`). This module derives nothing new — it
only asks `FamilyTree` the right sequence of questions and reports the first
term in `RELATIONSHIP_TERMS` that applies.

`relationship_between(tree, a_id, b_id)` describes what `a` is *to* `b`, so
direction matters: if `a` is `b`'s mother, the answer is `"parent"`, and
`relationship_between(tree, b_id, a_id)` answers `"child"`.

Precedence, most specific first:

    self > spouse > parent > child > sibling > grandparent > grandchild >
    aunt-or-uncle > niece-or-nephew > cousin > unrelated

A person in a valid tree cannot satisfy two of these at once — you cannot be
both someone's parent and their grandparent — so the order mostly exists to
give a definite answer if the data ever were inconsistent, and to state
plainly which question is asked first.

Anything one hop further out than this vocabulary reaches — great-grandparents,
great-aunts, a cousin's child, an in-law — has no term to be returned, and
falls through to `"unrelated"`. `FamilyTree` itself stops deriving at
grandparents and cousins, so there is nothing further to ask it.
"""

from api.tree import FamilyTree

RELATIONSHIP_TERMS = (
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


def relationship_between(tree: FamilyTree, a_id: str, b_id: str) -> str:
    """How `a_id` is related to `b_id`, as one of `RELATIONSHIP_TERMS`.

    Raises `api.tree.DataError` if either id is not in the tree.
    """
    # Raises DataError for either unknown id before anything below runs.
    tree.get(a_id)
    tree.get(b_id)

    if a_id == b_id:
        return "self"

    spouse = tree.spouse(a_id)
    if spouse is not None and spouse.id == b_id:
        return "spouse"

    if any(parent.id == a_id for parent in tree.parents(b_id)):
        return "parent"

    if any(parent.id == b_id for parent in tree.parents(a_id)):
        return "child"

    if any(sibling.id == b_id for sibling in tree.siblings(a_id)):
        return "sibling"

    if any(grandparent.id == a_id for grandparent in tree.grandparents(b_id)):
        return "grandparent"

    if any(grandparent.id == b_id for grandparent in tree.grandparents(a_id)):
        return "grandchild"

    if _is_aunt_or_uncle(tree, a_id, b_id):
        return "aunt-or-uncle"

    if _is_aunt_or_uncle(tree, b_id, a_id):
        return "niece-or-nephew"

    if any(cousin.id == b_id for cousin in tree.cousins(a_id)):
        return "cousin"

    return "unrelated"


def _is_aunt_or_uncle(tree: FamilyTree, a_id: str, b_id: str) -> bool:
    """True when `a_id` is a sibling of one of `b_id`'s parents."""
    return any(
        a_id in {sibling.id for sibling in tree.siblings(parent.id)}
        for parent in tree.parents(b_id)
    )
