"""Fixtures shared by the suite.

`tree` loads the repository's own `data/family.json` through
`FamilyTree.load()` with no path, so the suite also fails if this project's
dependency on `apps/api` ever stops resolving the data directory — which it
would if the api package were installed non-editably.
"""

from collections.abc import AsyncIterator, Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager

import pytest
from api.tree import FamilyTree
from mcp import Client

from family_mcp.server import build_server


@pytest.fixture(scope="session")
def tree() -> FamilyTree:
    return FamilyTree.load()


@pytest.fixture
def connect(tree: FamilyTree) -> Callable[[], AbstractAsyncContextManager[Client]]:
    """Open a real MCP client onto the real server, over in-memory streams.

    Every request and response is encoded and dispatched the way a stdio
    client's would be, so a tool that is written but never registered, or an
    argument the schema rejects, fails in the test rather than passing quietly.

    Handed to the test as a factory rather than as an async fixture: an async
    fixture is entered in a different task from the test body, and the SDK's
    cancel scopes refuse to be closed from one.
    """

    @asynccontextmanager
    async def _connect() -> AsyncIterator[Client]:
        async with Client(build_server(tree)) as client:
            yield client

    return _connect
