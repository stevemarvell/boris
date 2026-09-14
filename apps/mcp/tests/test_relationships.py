"""`relationship_between` over the real tree, plus the half-siblings it lacks.

Every expected value here is written out from `data/family.json` by hand. None
of them is computed by calling the thing under test, so a change of answer is
a failure rather than a change of expectation.
"""

import pytest
from api.models import Person
from api.tree import DataError, FamilyTree

from family_mcp.relationships import RELATIONSHIP_TERMS, relationship_between


@pytest.mark.parametrize(
    ("a", "b", "expected"),
    [
        # Fred Shaw is the well-connected one: spouse, both parents, two
        # children, a sibling, four grandparents, five cousins.
        ("fred-shaw", "fred-shaw", "self"),
        ("fred-shaw", "ellie-shaw", "spouse"),
        ("ellie-shaw", "fred-shaw", "spouse"),
        ("fred-shaw", "daisy-shaw", "parent"),
        ("daisy-shaw", "fred-shaw", "child"),
        ("fred-shaw", "sally-baker", "sibling"),
        ("sally-baker", "fred-shaw", "sibling"),
        ("frank-shaw", "daisy-shaw", "grandparent"),
        ("daisy-shaw", "frank-shaw", "grandchild"),
        ("sally-baker", "daisy-shaw", "aunt-or-uncle"),
        ("daisy-shaw", "sally-baker", "niece-or-nephew"),
        ("hugo-shaw", "fred-shaw", "cousin"),
        ("fred-shaw", "hugo-shaw", "cousin"),
        # Nora Pike never married and has no children, but she is Nancy's
        # sister, which makes her Ellie's aunt.
        ("nora-pike", "ellie-shaw", "aunt-or-uncle"),
        ("ellie-shaw", "nora-pike", "niece-or-nephew"),
        ("nora-pike", "nancy-nunn", "sibling"),
        # Olivia Vance is married with no children.
        ("olivia-vance", "peter-vance", "spouse"),
        ("olivia-vance", "ellie-shaw", "sibling"),
        # Albert Shaw is the oldest generation: no parents, so no siblings, so
        # nobody is his cousin or his nephew.
        ("albert-shaw", "frank-shaw", "parent"),
        ("albert-shaw", "hugo-shaw", "grandparent"),
        ("albert-shaw", "agnes-shaw", "spouse"),
        # Hugo Shaw is an only child; Gemma is his cousin, not his sister.
        ("gemma-hale", "hugo-shaw", "cousin"),
        # The vocabulary has no word for these, so they are `unrelated` —
        # which is why the tool description says that is not "no connection".
        ("albert-shaw", "daisy-shaw", "unrelated"),  # great-grandparent
        ("daisy-shaw", "albert-shaw", "unrelated"),  # great-grandchild
        ("tom-baker", "fred-shaw", "unrelated"),  # brother-in-law
        ("peter-vance", "ellie-shaw", "unrelated"),  # married in
        ("nora-pike", "albert-shaw", "unrelated"),  # different branch entirely
        ("toby-baker", "rosie-nunn", "unrelated"),  # joined only by Fred and Ellie's marriage
    ],
)
def test_named_relationships(tree: FamilyTree, a: str, b: str, expected: str) -> None:
    assert relationship_between(tree, a, b) == expected


def test_every_answer_is_in_the_vocabulary(tree: FamilyTree) -> None:
    """No pair in the real tree produces a term a client could not switch on."""
    ids = sorted(tree.people)
    for a in ids:
        for b in ids:
            assert relationship_between(tree, a, b) in RELATIONSHIP_TERMS


INVERSE = {
    "self": "self",
    "spouse": "spouse",
    "sibling": "sibling",
    "cousin": "cousin",
    "unrelated": "unrelated",
    "parent": "child",
    "child": "parent",
    "grandparent": "grandchild",
    "grandchild": "grandparent",
    "aunt-or-uncle": "niece-or-nephew",
    "niece-or-nephew": "aunt-or-uncle",
}


def test_swapping_the_arguments_inverts_the_answer(tree: FamilyTree) -> None:
    """Direction is a property of the pair, not an accident of precedence.

    Written as a table of inverses rather than by calling the function twice
    and comparing it to itself: if precedence ever reordered so that one
    direction found `sibling` where the other found `cousin`, this fails.
    """
    assert set(INVERSE) == set(RELATIONSHIP_TERMS)
    ids = sorted(tree.people)
    for a in ids:
        for b in ids:
            assert relationship_between(tree, b, a) == INVERSE[relationship_between(tree, a, b)]


def half_sibling_tree() -> FamilyTree:
    """Two children of one father by different mothers, and their children.

    `data/family.json` contains no half-siblings — every person with parents
    has both from the same couple — so the case the `FamilyTree.cousins`
    docstring is careful about cannot be reached from the real data at all.
    It is built here instead, and deliberately not added to the real tree.
    """
    return FamilyTree(
        [
            Person(id="dad", name="Dad", parents=(), spouse=None),
            Person(id="mum-one", name="Mum One", parents=(), spouse=None),
            Person(id="mum-two", name="Mum Two", parents=(), spouse=None),
            Person(id="older", name="Older", parents=("dad", "mum-one"), spouse=None),
            Person(id="younger", name="Younger", parents=("dad", "mum-two"), spouse=None),
            Person(id="olders-kid", name="Olders Kid", parents=("older",), spouse=None),
            Person(id="youngers-kid", name="Youngers Kid", parents=("younger",), spouse=None),
        ]
    )


@pytest.mark.parametrize(
    ("a", "b", "expected"),
    [
        ("older", "younger", "sibling"),
        ("younger", "older", "sibling"),
        ("younger", "olders-kid", "aunt-or-uncle"),
        ("olders-kid", "younger", "niece-or-nephew"),
        ("olders-kid", "youngers-kid", "cousin"),
        ("mum-one", "younger", "unrelated"),
        ("mum-one", "youngers-kid", "unrelated"),
        ("dad", "olders-kid", "grandparent"),
    ],
)
def test_half_siblings(a: str, b: str, expected: str) -> None:
    assert relationship_between(half_sibling_tree(), a, b) == expected


@pytest.mark.parametrize(
    ("a", "b"),
    [("nobody-at-all", "fred-shaw"), ("fred-shaw", "nobody-at-all")],
)
def test_an_unknown_id_is_an_error_from_either_side(tree: FamilyTree, a: str, b: str) -> None:
    with pytest.raises(DataError, match="no person with id nobody-at-all"):
        relationship_between(tree, a, b)
