"""Where the running server gets its `FamilyTree` from.

A single module-level tree, loaded once from `data/family.json` (or
`FAMILY_DATA`, if set — see `api.tree.default_data_path`) the first time it
is asked for, then reused. Tests do not go through this: they build a
`FamilyTree` from an in-memory list of `Person` and pass it straight to the
functions in `family_mcp.tools`, so nothing here needs mocking.
"""

from api.tree import FamilyTree

_tree: FamilyTree | None = None


def get_tree() -> FamilyTree:
    global _tree
    if _tree is None:
        _tree = FamilyTree.load()
    return _tree
