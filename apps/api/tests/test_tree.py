import json

import pytest

from api.models import Person
from api.tree import DataError, FamilyTree


def build(*rows: tuple[str, tuple[str, ...], str | None]) -> FamilyTree:
    return FamilyTree([Person(id=i, name=i.title(), parents=p, spouse=s) for i, p, s in rows])


@pytest.fixture(scope="module")
def tree() -> FamilyTree:
    return FamilyTree.load()


# -- the shipped fixture ------------------------------------------------


def test_fixture_loads(tree: FamilyTree) -> None:
    assert len(tree.people) == 44


def test_fred_and_ellie_are_married(tree: FamilyTree) -> None:
    assert tree.spouse("fred-shaw").id == "ellie-shaw"
    assert tree.spouse("ellie-shaw").id == "fred-shaw"


def test_fred_and_ellie_have_two_children(tree: FamilyTree) -> None:
    assert [c.name for c in tree.children("fred-shaw")] == ["Daisy Shaw", "Sam Shaw"]
    assert tree.children("ellie-shaw") == tree.children("fred-shaw")


def test_four_generations(tree: FamilyTree) -> None:
    generations = tree.generations()
    assert len(generations) == 4
    assert {p.id for p in generations[0]} >= {"albert-shaw", "dorothy-pike"}
    assert {p.id for p in generations[3]} == {
        "daisy-shaw",
        "sam-shaw",
        "toby-baker",
        "rosie-nunn",
        "rory-nunn",
    }


def test_married_in_partners_sit_with_their_spouse(tree: FamilyTree) -> None:
    """Tom Baker has no parents here, but belongs beside Sally, not at the top."""
    assert tree.generation_of("tom-baker") == tree.generation_of("sally-baker")
    assert tree.generation_of("tom-baker") == tree.generation_of("fred-shaw")


def test_grandparents_are_derived(tree: FamilyTree) -> None:
    assert [g.name for g in tree.grandparents("fred-shaw")] == [
        "Agnes Shaw",
        "Albert Shaw",
        "Beatrice Clay",
        "Bernard Clay",
    ]


def test_childrens_grandparents_are_freds_parents(tree: FamilyTree) -> None:
    assert {g.id for g in tree.grandparents("daisy-shaw")} == {
        "frank-shaw",
        "margaret-shaw",
        "edward-nunn",
        "nancy-nunn",
    }


def test_siblings_share_a_parent(tree: FamilyTree) -> None:
    assert [s.name for s in tree.siblings("ellie-shaw")] == ["Oliver Nunn", "Olivia Vance"]
    assert [s.name for s in tree.siblings("daisy-shaw")] == ["Sam Shaw"]


def test_cousins_come_from_both_sides(tree: FamilyTree) -> None:
    """Fred's cousins are Frank's nephews and nieces plus Margaret's."""
    assert [c.name for c in tree.cousins("fred-shaw")] == [
        "Gemma Hale",
        "George Hale",
        "Hugo Shaw",
        "Isaac Clay",
        "Ivy Clay",
    ]


def test_cousins_exclude_siblings_and_self(tree: FamilyTree) -> None:
    cousins = {c.id for c in tree.cousins("daisy-shaw")}
    assert cousins == {"rory-nunn", "rosie-nunn", "toby-baker"}
    assert "sam-shaw" not in cousins
    assert "daisy-shaw" not in cousins


def test_descendants_reach_the_bottom_of_the_tree(tree: FamilyTree) -> None:
    """Albert heads one line; the married-in partners below him are not his."""
    assert [d.name for d in tree.descendants("albert-shaw")] == [
        "Daisy Shaw",
        "Felix Shaw",
        "Fiona Hale",
        "Frank Shaw",
        "Fred Shaw",
        "Gemma Hale",
        "George Hale",
        "Hugo Shaw",
        "Sally Baker",
        "Sam Shaw",
        "Toby Baker",
    ]
    assert "harriet-shaw" not in {d.id for d in tree.descendants("albert-shaw")}


def test_descendants_of_a_middle_generation(tree: FamilyTree) -> None:
    assert [d.name for d in tree.descendants("fred-shaw")] == ["Daisy Shaw", "Sam Shaw"]
    assert tree.descendants("ellie-shaw") == tree.descendants("fred-shaw")


# -- the zero cases -----------------------------------------------------


def test_grandparents_have_no_siblings_and_no_parents(tree: FamilyTree) -> None:
    assert tree.siblings("albert-shaw") == []
    assert tree.parents("albert-shaw") == []
    assert tree.grandparents("albert-shaw") == []


def test_unmarried_person_has_no_spouse_and_no_children(tree: FamilyTree) -> None:
    assert tree.spouse("nora-pike") is None
    assert tree.children("nora-pike") == []


def test_married_couple_with_no_children(tree: FamilyTree) -> None:
    assert tree.spouse("olivia-vance").id == "peter-vance"
    assert tree.children("olivia-vance") == []


def test_oldest_generation_has_no_cousins(tree: FamilyTree) -> None:
    assert tree.cousins("albert-shaw") == []


def test_cousins_are_empty_when_the_parents_are_only_children(tree: FamilyTree) -> None:
    """Nora's parents married in from nowhere, so there are no aunts to have children."""
    assert tree.cousins("nora-pike") == []


def test_youngest_generation_has_no_descendants(tree: FamilyTree) -> None:
    assert tree.descendants("daisy-shaw") == []
    assert tree.descendants("sam-shaw") == []


def test_childless_person_has_no_descendants(tree: FamilyTree) -> None:
    assert tree.descendants("nora-pike") == []


def test_only_child_has_no_siblings(tree: FamilyTree) -> None:
    assert tree.siblings("hugo-shaw") == []
    assert tree.siblings("jasper-reed") == []


def test_empty_tree() -> None:
    empty = FamilyTree([])
    assert empty.generations() == []


# -- derivation rules in isolation --------------------------------------


def test_half_siblings_count_as_siblings() -> None:
    t = build(
        ("mum", (), None),
        ("dad", (), None),
        ("step", (), None),
        ("a", ("mum", "dad"), None),
        ("b", ("mum", "step"), None),
    )
    assert [s.id for s in t.siblings("a")] == ["b"]


def test_person_with_no_parents_has_no_siblings() -> None:
    t = build(("a", (), None), ("b", (), None))
    assert t.siblings("a") == []


def test_a_cousin_reachable_through_both_parents_is_listed_once() -> None:
    t = build(
        ("gp1", (), None),
        ("gp2", (), None),
        ("mum", ("gp1",), None),
        ("aunt", ("gp1",), None),
        ("dad", ("gp2",), None),
        ("uncle", ("gp2",), None),
        ("kid", ("mum", "dad"), None),
        ("cousin", ("aunt", "uncle"), None),
    )
    assert [c.id for c in t.cousins("kid")] == ["cousin"]


def test_descendants_terminate_on_a_parent_cycle() -> None:
    """A cycle must not hang the walk; generations() is what reports it."""
    t = build(("a", ("b",), None), ("b", ("a",), None))
    assert [d.id for d in t.descendants("a")] == ["b"]
    with pytest.raises(DataError, match="cycle"):
        t.generations()


def test_unknown_person_is_rejected(tree: FamilyTree) -> None:
    with pytest.raises(DataError, match="no person with id"):
        tree.get("nobody")


# -- the file cannot contradict itself ----------------------------------


def test_unknown_parent_is_rejected() -> None:
    with pytest.raises(DataError, match="unknown parent"):
        build(("a", ("ghost",), None))


def test_one_sided_marriage_is_rejected() -> None:
    with pytest.raises(DataError, match="disagree about marriage"):
        build(("a", (), "b"), ("b", (), None))


def test_duplicate_id_is_rejected() -> None:
    with pytest.raises(DataError, match="duplicate id"):
        build(("a", (), None), ("a", (), None))


def test_self_parenting_is_rejected() -> None:
    with pytest.raises(DataError, match="their own parent"):
        build(("a", ("a",), None))


def test_parent_cycle_is_rejected() -> None:
    with pytest.raises(DataError, match="cycle"):
        build(("a", ("b",), None), ("b", ("a",), None)).generations()


def test_missing_file_is_reported(tmp_path) -> None:
    with pytest.raises(DataError, match="no family file"):
        FamilyTree.load(tmp_path / "nope.json")


def test_malformed_file_is_reported(tmp_path) -> None:
    bad = tmp_path / "family.json"
    bad.write_text("{oops", encoding="utf-8")
    with pytest.raises(DataError, match="not valid JSON"):
        FamilyTree.load(bad)


def test_round_trips_through_json(tmp_path, tree: FamilyTree) -> None:
    path = tmp_path / "family.json"
    path.write_text(
        json.dumps(
            {
                "people": [
                    {"id": p.id, "name": p.name, "parents": list(p.parents), "spouse": p.spouse}
                    for p in tree.people.values()
                ]
            }
        ),
        encoding="utf-8",
    )
    assert FamilyTree.load(path).people == tree.people
