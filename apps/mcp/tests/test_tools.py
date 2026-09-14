"""`get_person` and `find_people`, tested against the real family tree.

These call `family_mcp.tools` directly rather than going through the MCP
server, so a failure here points at the derivation logic and not at the
transport. `test_server.py` covers the MCP wiring on top of this.
"""

import pytest
from api.tree import DataError, FamilyTree

from family_mcp import tools


def ids(people: list[dict[str, object]]) -> set[str]:
    return {p["id"] for p in people}


# -- get_person: the edge cases named in the task -----------------------


def test_albert_shaw_is_the_oldest_generation_with_no_parents_or_siblings(tree: FamilyTree) -> None:
    person = tools.get_person(tree, "albert-shaw")
    assert person["id"] == "albert-shaw"
    assert person["name"] == "Albert Shaw"
    assert person["generation"] == 0
    assert person["parents"] == []
    assert person["siblings"] == []
    assert person["grandparents"] == []
    assert person["cousins"] == []
    # Still has a spouse and children — this is "oldest generation", not
    # "isolated". A test that let this fall to an empty dict would not
    # distinguish "correctly derived nothing" from "silently broke".
    assert person["spouse"] == {"id": "agnes-shaw", "name": "Agnes Shaw"}
    assert ids(person["children"]) == {"felix-shaw", "fiona-hale", "frank-shaw"}


def test_nora_pike_never_married_and_childless_but_has_parents_and_siblings(
    tree: FamilyTree,
) -> None:
    person = tools.get_person(tree, "nora-pike")
    assert person["spouse"] is None
    assert person["children"] == []
    assert ids(person["parents"]) == {"douglas-pike", "dorothy-pike"}
    # Neville Pike and Nancy Nunn (married out of the Pike name) are both
    # children of Douglas and Dorothy Pike.
    assert ids(person["siblings"]) == {"neville-pike", "nancy-nunn"}


def test_olivia_vance_married_with_no_children(tree: FamilyTree) -> None:
    person = tools.get_person(tree, "olivia-vance")
    assert person["spouse"] == {"id": "peter-vance", "name": "Peter Vance"}
    assert person["children"] == []


def test_hugo_shaw_is_an_only_child(tree: FamilyTree) -> None:
    person = tools.get_person(tree, "hugo-shaw")
    assert ids(person["parents"]) == {"felix-shaw", "harriet-shaw"}
    assert person["siblings"] == []


def test_fred_shaw_is_well_connected(tree: FamilyTree) -> None:
    person = tools.get_person(tree, "fred-shaw")
    assert person["spouse"] == {"id": "ellie-shaw", "name": "Ellie Shaw"}
    assert ids(person["parents"]) == {"frank-shaw", "margaret-shaw"}
    assert ids(person["children"]) == {"daisy-shaw", "sam-shaw"}
    assert ids(person["siblings"]) == {"sally-baker"}
    assert ids(person["grandparents"]) == {
        "albert-shaw",
        "agnes-shaw",
        "bernard-clay",
        "beatrice-clay",
    }


def test_get_person_unknown_id_raises_data_error(tree: FamilyTree) -> None:
    # Not an empty result: a client that only checks "did I get a person
    # back" would otherwise read a typo'd id as "this person has no data".
    with pytest.raises(DataError):
        tools.get_person(tree, "nobody-here")


# -- find_people -----------------------------------------------------------


def test_find_people_matches_a_fragment_case_insensitively(tree: FamilyTree) -> None:
    lower = ids(tools.find_people(tree, "shaw"))
    upper = ids(tools.find_people(tree, "SHAW"))
    mixed = ids(tools.find_people(tree, "ShAw"))
    assert lower == upper == mixed
    assert "fred-shaw" in lower
    assert "albert-shaw" in lower
    # A Baker or a Pike should not show up for a Shaw query.
    assert "tom-baker" not in lower


def test_find_people_matches_a_middle_fragment(tree: FamilyTree) -> None:
    # "hale-nunn" is a hyphenated name (Gemma Hale-Nunn); matching on a
    # fragment in the middle of it, not just a whole word, is the point of
    # "fragment" rather than "word".
    results = ids(tools.find_people(tree, "le-nu"))
    assert results == {"gemma-hale"}


def test_find_people_no_match_is_an_empty_list_not_an_error(tree: FamilyTree) -> None:
    assert tools.find_people(tree, "zzz-nobody-named-this") == []
