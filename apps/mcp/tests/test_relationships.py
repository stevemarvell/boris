"""`relationship_between`, tested against the real family tree.

Every case below is a real pair from `data/family.json`, chosen to hit every
term in the fixed vocabulary at least once, plus both directions of the
asymmetric parent/child pair (and, since the tree makes it easy, the
aunt-or-uncle/niece-or-nephew pair too). A test here fails only if
`relationship_between` actually stops asking `FamilyTree` the right question
for that case — nothing here recomputes an expected value from the same
code path it is checking.
"""

import pytest
from api.tree import DataError, FamilyTree

from family_mcp.relationships import relationship_between


def test_self(tree: FamilyTree) -> None:
    assert relationship_between(tree, "fred-shaw", "fred-shaw") == "self"


def test_spouse_is_symmetric(tree: FamilyTree) -> None:
    assert relationship_between(tree, "albert-shaw", "agnes-shaw") == "spouse"
    assert relationship_between(tree, "agnes-shaw", "albert-shaw") == "spouse"


def test_parent_and_child_are_opposite_directions(tree: FamilyTree) -> None:
    # Albert Shaw is Frank Shaw's father.
    assert relationship_between(tree, "albert-shaw", "frank-shaw") == "parent"
    assert relationship_between(tree, "frank-shaw", "albert-shaw") == "child"


def test_sibling_is_symmetric(tree: FamilyTree) -> None:
    # Frank Shaw and Fiona Hale share both parents.
    assert relationship_between(tree, "frank-shaw", "fiona-hale") == "sibling"
    assert relationship_between(tree, "fiona-hale", "frank-shaw") == "sibling"


def test_grandparent_and_grandchild_are_opposite_directions(tree: FamilyTree) -> None:
    # Albert Shaw is Fred Shaw's grandfather, through Frank Shaw.
    assert relationship_between(tree, "albert-shaw", "fred-shaw") == "grandparent"
    assert relationship_between(tree, "fred-shaw", "albert-shaw") == "grandchild"


def test_aunt_or_uncle_and_niece_or_nephew_are_opposite_directions(tree: FamilyTree) -> None:
    # Sally Baker is Fred Shaw's sister, and Daisy Shaw is Fred Shaw's
    # daughter — Sally is Daisy's aunt.
    assert relationship_between(tree, "sally-baker", "daisy-shaw") == "aunt-or-uncle"
    assert relationship_between(tree, "daisy-shaw", "sally-baker") == "niece-or-nephew"


def test_cousin_is_symmetric(tree: FamilyTree) -> None:
    # Toby Baker (Sally Baker's son) and Daisy Shaw (Fred Shaw's daughter)
    # are cousins through their parents' sibling relationship.
    assert relationship_between(tree, "toby-baker", "daisy-shaw") == "cousin"
    assert relationship_between(tree, "daisy-shaw", "toby-baker") == "cousin"


def test_unrelated(tree: FamilyTree) -> None:
    # Two founding couples with no shared descendant between them (only a
    # later in-law link, which is not in the fixed vocabulary).
    assert relationship_between(tree, "albert-shaw", "bernard-clay") == "unrelated"
    assert relationship_between(tree, "bernard-clay", "albert-shaw") == "unrelated"


def test_unknown_id_raises_data_error_not_unrelated(tree: FamilyTree) -> None:
    # "unrelated" is a real answer about two real people; a typo'd id must
    # not be able to produce the same answer as a legitimate query.
    with pytest.raises(DataError):
        relationship_between(tree, "nobody-here", "fred-shaw")
    with pytest.raises(DataError):
        relationship_between(tree, "fred-shaw", "nobody-here")
