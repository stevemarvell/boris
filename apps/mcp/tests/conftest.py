"""Shared fixtures for the MCP server tests.

Every test here runs against the real `data/family.json` — the same file
`apps/api`'s own tests and the deployed API use — rather than an invented
fixture tree, per the task's edge-case list. `FamilyTree.load()` resolves the
file by walking up from `api/tree.py`'s own location, so it finds the real
repository data regardless of where `pytest` is invoked from.
"""

import pytest
from api.tree import FamilyTree


@pytest.fixture(scope="session")
def tree() -> FamilyTree:
    return FamilyTree.load()
