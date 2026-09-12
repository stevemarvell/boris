"""Derived views over the stored people."""

import json
import os
from functools import cached_property
from pathlib import Path

from api.models import Person


class DataError(Exception):
    """The family file is missing, malformed, or internally inconsistent."""


def default_data_path() -> Path:
    """Locate data/family.json by walking up from this module.

    Works unchanged in the repository and in the container, where the data
    directory is copied to /app/data. FAMILY_DATA overrides it.
    """
    override = os.environ.get("FAMILY_DATA")
    if override:
        return Path(override)
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "data" / "family.json"
        if candidate.exists():
            return candidate
    raise DataError("could not locate data/family.json; set FAMILY_DATA")


class FamilyTree:
    def __init__(self, people: list[Person]) -> None:
        self.people: dict[str, Person] = {}
        for person in people:
            if person.id in self.people:
                raise DataError(f"duplicate id: {person.id}")
            self.people[person.id] = person
        self._check_references()

    @classmethod
    def load(cls, path: Path | None = None) -> "FamilyTree":
        path = path or default_data_path()
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError as err:
            raise DataError(f"no family file at {path}") from err
        except json.JSONDecodeError as err:
            raise DataError(f"{path} is not valid JSON: {err}") from err
        return cls([Person.from_json(p) for p in raw.get("people", [])])

    def _check_references(self) -> None:
        for person in self.people.values():
            for parent in person.parents:
                if parent not in self.people:
                    raise DataError(f"{person.id} names unknown parent {parent}")
            if person.spouse is not None:
                if person.spouse not in self.people:
                    raise DataError(f"{person.id} names unknown spouse {person.spouse}")
                if self.people[person.spouse].spouse != person.id:
                    raise DataError(f"{person.id} and {person.spouse} disagree about marriage")
            if person.id in person.parents:
                raise DataError(f"{person.id} is their own parent")

    # -- lookups ---------------------------------------------------------

    def get(self, person_id: str) -> Person:
        try:
            return self.people[person_id]
        except KeyError:
            raise DataError(f"no person with id {person_id}") from None

    def _sorted(self, people: list[Person]) -> list[Person]:
        return sorted(people, key=lambda p: (p.name, p.id))

    def parents(self, person_id: str) -> list[Person]:
        return self._sorted([self.people[p] for p in self.get(person_id).parents])

    def spouse(self, person_id: str) -> Person | None:
        partner = self.get(person_id).spouse
        return self.people[partner] if partner else None

    def children(self, person_id: str) -> list[Person]:
        self.get(person_id)
        return self._sorted([p for p in self.people.values() if person_id in p.parents])

    def siblings(self, person_id: str) -> list[Person]:
        """Anyone sharing at least one parent. Parentless people have none."""
        person = self.get(person_id)
        if not person.parents:
            return []
        shared = set(person.parents)
        return self._sorted(
            [
                p
                for p in self.people.values()
                if p.id != person_id and shared.intersection(p.parents)
            ]
        )

    def grandparents(self, person_id: str) -> list[Person]:
        seen = {
            grandparent
            for parent in self.get(person_id).parents
            for grandparent in self.people[parent].parents
        }
        return self._sorted([self.people[g] for g in seen])

    def cousins(self, person_id: str) -> list[Person]:
        """The children of a parent's siblings.

        Half-siblings make an aunt reachable through either parent, so the
        results are collected by id before sorting. Anyone who is already a
        sibling — or the person themselves — is not a cousin.
        """
        person = self.get(person_id)
        excluded = {person_id} | {s.id for s in self.siblings(person_id)}
        found = {
            child.id: child
            for parent in person.parents
            for aunt_or_uncle in self.siblings(parent)
            for child in self.children(aunt_or_uncle.id)
            if child.id not in excluded
        }
        return self._sorted(list(found.values()))

    def descendants(self, person_id: str) -> list[Person]:
        """Children, their children, and on down.

        A parent cycle would make this walk forever, so nobody already reached
        is expanded twice — the cycle surfaces as a DataError from
        `generations()` rather than as a hang here.
        """
        self.get(person_id)
        found: dict[str, Person] = {}
        frontier = [person_id]
        while frontier:
            for child in self.children(frontier.pop()):
                if child.id == person_id or child.id in found:
                    continue
                found[child.id] = child
                frontier.append(child.id)
        return self._sorted(list(found.values()))

    # -- generations -----------------------------------------------------

    @cached_property
    def _generation(self) -> dict[str, int]:
        """Depth from the oldest ancestors, with married-in partners levelled.

        Someone who married into the family has no parents here, so descent
        alone would place them in the oldest generation. A second pass lifts
        them to sit beside their spouse.
        """
        depth: dict[str, int] = {}
        limit = len(self.people) + 2

        for _ in range(limit):
            changed = False
            for person in self.people.values():
                if person.parents:
                    if all(p in depth for p in person.parents):
                        value = max(depth[p] for p in person.parents) + 1
                        if depth.get(person.id) != value:
                            depth[person.id] = value
                            changed = True
                elif person.id not in depth:
                    depth[person.id] = 0
                    changed = True
            if not changed:
                break

        # A cycle starves every person in it: each waits on a parent that is
        # itself waiting, so the pass above settles with them unassigned.
        if len(depth) != len(self.people):
            stuck = sorted(set(self.people) - set(depth))
            raise DataError(f"generations did not settle; parents form a cycle among {stuck}")

        for _ in range(limit):
            changed = False
            for person in self.people.values():
                if person.parents or person.spouse is None:
                    continue
                partner_depth = depth.get(person.spouse, 0)
                if partner_depth > depth[person.id]:
                    depth[person.id] = partner_depth
                    changed = True
            if not changed:
                break

        return depth

    def generation_of(self, person_id: str) -> int:
        self.get(person_id)
        return self._generation[person_id]

    def generations(self) -> list[list[Person]]:
        """People grouped oldest generation first."""
        if not self.people:
            return []
        buckets: dict[int, list[Person]] = {}
        for person in self.people.values():
            buckets.setdefault(self._generation[person.id], []).append(person)
        return [self._sorted(buckets[key]) for key in sorted(buckets)]
