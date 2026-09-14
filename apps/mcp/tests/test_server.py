"""The MCP server actually wires the three tools up correctly.

`test_tools.py` and `test_relationships.py` cover the derivation logic
directly; this file covers the layer on top of it — that the three tools are
registered under the names the task specifies, that a call reaches
`family_mcp.tools` and comes back with the right data, and, critically, that
an unknown id surfaces to the client as an actionable error rather than as
`DataError`'s raw text or an empty result. `server.call_tool(...)` is called
directly rather than over a stdio/subprocess transport: MCPServer's own tests
use the same in-process call, and adding a transport would test the `mcp`
package's transport code, not this server.
"""

import asyncio

import pytest
from mcp.server.mcpserver.exceptions import ToolError

from family_mcp.server import server


def call(name: str, arguments: dict[str, object]):
    return asyncio.run(server.call_tool(name, arguments))


def test_all_three_tools_are_registered() -> None:
    names = {t.name for t in asyncio.run(server.list_tools())}
    assert names == {"get_person", "find_people", "relationship_between"}


def test_get_person_reaches_the_real_tree() -> None:
    result = call("get_person", {"person_id": "hugo-shaw"})
    assert result.is_error is False
    assert result.structured_content["name"] == "Hugo Shaw"
    assert result.structured_content["siblings"] == []


def test_get_person_unknown_id_is_a_client_actionable_tool_error() -> None:
    # A ToolError (not DataError, not a bare exception) is what makes this
    # "an error a client can act on": the SDK keeps a ToolError's message
    # in the result the caller sees, and replaces any other exception's
    # text with a generic "Error executing tool ...". If get_person ever
    # let DataError escape unwrapped, this would turn from a ToolError
    # carrying "no person with id bogus-id" into an UnexpectedToolError
    # that hides why it failed.
    with pytest.raises(ToolError) as excinfo:
        call("get_person", {"person_id": "bogus-id"})
    assert "bogus-id" in str(excinfo.value)


def test_find_people_reaches_the_real_tree() -> None:
    result = call("find_people", {"query": "pike"})
    assert result.is_error is False
    found = {p["id"] for p in result.structured_content["result"]}
    assert "nora-pike" in found
    assert "fred-shaw" not in found


def test_relationship_between_reaches_the_real_tree_in_both_directions() -> None:
    parent = call("relationship_between", {"a": "albert-shaw", "b": "frank-shaw"})
    child = call("relationship_between", {"a": "frank-shaw", "b": "albert-shaw"})
    assert parent.structured_content["result"] == "parent"
    assert child.structured_content["result"] == "child"


def test_relationship_between_unknown_id_is_a_client_actionable_tool_error() -> None:
    with pytest.raises(ToolError) as excinfo:
        call("relationship_between", {"a": "bogus-id", "b": "fred-shaw"})
    assert "bogus-id" in str(excinfo.value)
