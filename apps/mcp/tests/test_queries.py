"""The shapes the tools return, checked against `data/family.json` by hand.

The edge cases the tree actually contains each get a whole person written out:
an empty list has to be empty for the right reason, and the only way to show
that is to say what the other lists hold at the same time.
"""

import pytest
from api.tree import DataError, FamilyTree

from family_mcp.queries import person_view, relationship_view, search


def test_the_oldest_generation_has_no_parents_and_no_siblings(tree: FamilyTree) -> None:
    """Albert Shaw. Parentless, so `siblings` is empty rather than everyone else."""
    assert person_view(tree, "albert-shaw") == {
        "id": "albert-shaw",
        "name": "Albert Shaw",
        "generation": 0,
        "spouse": {"id": "agnes-shaw", "name": "Agnes Shaw"},
        "parents": [],
        "children": [
            {"id": "felix-shaw", "name": "Felix Shaw"},
            {"id": "fiona-hale", "name": "Fiona Hale"},
            {"id": "frank-shaw", "name": "Frank Shaw"},
        ],
        "siblings": [],
        "grandparents": [],
        "cousins": [],
    }


def test_never_married_still_has_parents_and_siblings(tree: FamilyTree) -> None:
    """Nora Pike. No spouse and no children, which is not the same as no family."""
    view = person_view(tree, "nora-pike")
    assert view["spouse"] is None
    assert view["children"] == []
    assert view["parents"] == [
        {"id": "dorothy-pike", "name": "Dorothy Pike"},
        {"id": "douglas-pike", "name": "Douglas Pike"},
    ]
    assert view["siblings"] == [
        {"id": "nancy-nunn", "name": "Nancy Nunn"},
        {"id": "neville-pike", "name": "Neville Pike"},
    ]


def test_married_with_no_children(tree: FamilyTree) -> None:
    """Olivia Vance. A spouse and no children; both are facts, neither is a miss."""
    view = person_view(tree, "olivia-vance")
    assert view["spouse"] == {"id": "peter-vance", "name": "Peter Vance"}
    assert view["children"] == []
    assert view["siblings"] == [
        {"id": "ellie-shaw", "name": "Ellie Shaw"},
        {"id": "oliver-nunn", "name": "Oliver Nunn"},
    ]
    assert view["cousins"] == [
        {"id": "jasper-reed", "name": "Jasper Reed"},
        {"id": "kara-pike", "name": "Kara Pike"},
        {"id": "keith-pike", "name": "Keith Pike"},
    ]


def test_an_only_child_has_no_siblings_but_has_cousins(tree: FamilyTree) -> None:
    """Hugo Shaw. `siblings` empty while `cousins` is not — the two are derived apart."""
    view = person_view(tree, "hugo-shaw")
    assert view["siblings"] == []
    assert view["cousins"] == [
        {"id": "fred-shaw", "name": "Fred Shaw"},
        {"id": "gemma-hale", "name": "Gemma Hale-Nunn"},
        {"id": "george-hale", "name": "George Hale"},
        {"id": "sally-baker", "name": "Sally Baker"},
    ]
    assert view["grandparents"] == [
        {"id": "agnes-shaw", "name": "Agnes Shaw"},
        {"id": "albert-shaw", "name": "Albert Shaw"},
    ]


def test_the_well_connected_case(tree: FamilyTree) -> None:
    """Fred Shaw. Every list on the person is non-empty."""
    assert person_view(tree, "fred-shaw") == {
        "id": "fred-shaw",
        "name": "Fred Shaw",
        "generation": 2,
        "spouse": {"id": "ellie-shaw", "name": "Ellie Shaw"},
        "parents": [
            {"id": "frank-shaw", "name": "Frank Shaw"},
            {"id": "margaret-shaw", "name": "Margaret Shaw"},
        ],
        "children": [
            {"id": "daisy-shaw", "name": "Daisy Shaw"},
            {"id": "sam-shaw", "name": "Sam Shaw"},
        ],
        "siblings": [{"id": "sally-baker", "name": "Sally Baker"}],
        "grandparents": [
            {"id": "agnes-shaw", "name": "Agnes Shaw"},
            {"id": "albert-shaw", "name": "Albert Shaw"},
            {"id": "beatrice-clay", "name": "Beatrice Clay"},
            {"id": "bernard-clay", "name": "Bernard Clay"},
        ],
        "cousins": [
            {"id": "gemma-hale", "name": "Gemma Hale-Nunn"},
            {"id": "george-hale", "name": "George Hale"},
            {"id": "hugo-shaw", "name": "Hugo Shaw"},
            {"id": "isaac-clay", "name": "Isaac Clay"},
            {"id": "ivy-clay", "name": "Ivy Clay"},
        ],
    }


def test_a_married_in_partner_sits_in_their_spouses_generation(tree: FamilyTree) -> None:
    """Harriet Shaw has no parents but is not in the oldest generation."""
    assert person_view(tree, "harriet-shaw")["generation"] == 1
    assert person_view(tree, "felix-shaw")["generation"] == 1
    assert person_view(tree, "hugo-shaw")["generation"] == 2


def test_an_unknown_id_is_an_error(tree: FamilyTree) -> None:
    with pytest.raises(DataError, match="no person with id nobody-at-all"):
        person_view(tree, "nobody-at-all")


def test_search_is_case_insensitive_and_ordered_by_name(tree: FamilyTree) -> None:
    expected = [
        {"id": "fiona-hale", "name": "Fiona Hale"},
        {"id": "gemma-hale", "name": "Gemma Hale-Nunn"},
        {"id": "george-hale", "name": "George Hale"},
        {"id": "gregory-hale", "name": "Gregory Hale"},
    ]
    assert search(tree, "hale") == expected
    assert search(tree, "HALE") == expected
    assert search(tree, "HaLe") == expected


def test_search_matches_a_fragment_anywhere_in_the_name(tree: FamilyTree) -> None:
    assert search(tree, "eanor") == [{"id": "eleanor-reed", "name": "Eleanor Reed"}]


def test_search_reads_names_not_ids(tree: FamilyTree) -> None:
    """`gemma-hale` is an id; her name is "Gemma Hale-Nunn", which does not contain it.

    If the search ever started matching ids too, this would return her.
    """
    assert search(tree, "gemma-hale") == []
    assert search(tree, "Gemma") == [{"id": "gemma-hale", "name": "Gemma Hale-Nunn"}]


def test_search_with_no_match_is_empty(tree: FamilyTree) -> None:
    assert search(tree, "zzzz") == []


@pytest.mark.parametrize("query", ["", "   ", "\t\n"])
def test_a_blank_search_is_an_error_not_the_whole_tree(tree: FamilyTree, query: str) -> None:
    with pytest.raises(ValueError, match="query must not be blank"):
        search(tree, query)


def test_relationship_view_names_both_people(tree: FamilyTree) -> None:
    assert relationship_view(tree, "sally-baker", "daisy-shaw") == {
        "a": {"id": "sally-baker", "name": "Sally Baker"},
        "b": {"id": "daisy-shaw", "name": "Daisy Shaw"},
        "relationship": "aunt-or-uncle",
    }
