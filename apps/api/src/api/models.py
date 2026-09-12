"""The stored shape of a person.

A person is a name plus the two relationships that cannot be inferred from
anyone else: who their parents are, and who they married. Everything else —
children, siblings, grandparents, cousins, which generation they belong to —
is derived in `tree.py`, so the file on disk cannot contradict itself.
"""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Person:
    id: str
    name: str
    parents: tuple[str, ...]
    spouse: str | None

    @classmethod
    def from_json(cls, raw: dict[str, object]) -> "Person":
        parents = raw.get("parents") or []
        spouse = raw.get("spouse")
        if not isinstance(parents, list):
            raise ValueError(f"parents must be a list: {raw!r}")
        return cls(
            id=str(raw["id"]),
            name=str(raw["name"]),
            parents=tuple(str(p) for p in parents),
            spouse=str(spouse) if spouse is not None else None,
        )
