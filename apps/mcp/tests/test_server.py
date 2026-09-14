"""The server as a client meets it: over a session, through the schemas.

These go through `mcp.Client`, which initialises a session and exchanges real
JSON-RPC messages with the server over in-memory streams. A tool that exists
as a function but was never registered, an argument name the schema does not
accept, or a return value that will not serialise, fails here — none of which
the direct tests in `test_queries.py` can see.
"""

import json
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from typing import Any

import pytest
from mcp import Client
from mcp.types import CallToolResult, TextContent

from family_mcp.relationships import RELATIONSHIP_TERMS

Connect = Callable[[], AbstractAsyncContextManager[Client]]


def text_of(result: CallToolResult) -> str:
    return "\n".join(block.text for block in result.content if isinstance(block, TextContent))


async def ok(client: Client, name: str, arguments: dict[str, Any]) -> Any:
    result = await client.call_tool(name, arguments)
    assert result.is_error is False, text_of(result)
    assert result.structured_content is not None
    return result.structured_content


async def test_the_three_tools_are_registered(connect: Connect) -> None:
    async with connect() as client:
        listed = await client.list_tools()
    assert sorted(tool.name for tool in listed.tools) == [
        "find_people",
        "get_person",
        "relationship_between",
    ]


async def test_each_tool_declares_the_arguments_the_task_names(connect: Connect) -> None:
    async with connect() as client:
        schemas = {tool.name: tool.input_schema for tool in (await client.list_tools()).tools}
    assert schemas["get_person"]["required"] == ["id"]
    assert schemas["find_people"]["required"] == ["query"]
    assert sorted(schemas["relationship_between"]["required"]) == ["a", "b"]


async def test_the_relationship_tool_advertises_the_whole_vocabulary(connect: Connect) -> None:
    """A client is told every answer it can get, and the list is the real one."""
    async with connect() as client:
        described = {t.name: t.description or "" for t in (await client.list_tools()).tools}
    for term in RELATIONSHIP_TERMS:
        assert term in described["relationship_between"]


async def test_get_person_over_the_session(connect: Connect) -> None:
    async with connect() as client:
        person = await ok(client, "get_person", {"id": "fred-shaw"})
    assert person["name"] == "Fred Shaw"
    assert person["spouse"] == {"id": "ellie-shaw", "name": "Ellie Shaw"}
    assert [c["id"] for c in person["children"]] == ["daisy-shaw", "sam-shaw"]
    assert [s["id"] for s in person["siblings"]] == ["sally-baker"]


async def test_get_person_for_someone_with_nothing_to_report(connect: Connect) -> None:
    """Nora Pike reaches the client with her empty lists intact, not dropped."""
    async with connect() as client:
        person = await ok(client, "get_person", {"id": "nora-pike"})
    assert person["spouse"] is None
    assert person["children"] == []
    assert person["cousins"] == []
    assert [p["id"] for p in person["parents"]] == ["dorothy-pike", "douglas-pike"]


async def test_find_people_over_the_session(connect: Connect) -> None:
    async with connect() as client:
        found = await ok(client, "find_people", {"query": "pike"})
    assert [p["id"] for p in found["result"]] == [
        "dorothy-pike",
        "douglas-pike",
        "kara-pike",
        "kathleen-pike",
        "keith-pike",
        "neville-pike",
        "nora-pike",
    ]


async def test_find_people_with_no_match_is_an_empty_list(connect: Connect) -> None:
    async with connect() as client:
        assert await ok(client, "find_people", {"query": "zzzz"}) == {"result": []}


@pytest.mark.parametrize(
    ("a", "b", "expected"),
    [
        ("fred-shaw", "daisy-shaw", "parent"),
        ("daisy-shaw", "fred-shaw", "child"),
        ("fred-shaw", "ellie-shaw", "spouse"),
        ("hugo-shaw", "fred-shaw", "cousin"),
        ("albert-shaw", "daisy-shaw", "unrelated"),
    ],
)
async def test_relationship_between_over_the_session(
    connect: Connect, a: str, b: str, expected: str
) -> None:
    async with connect() as client:
        answer = await ok(client, "relationship_between", {"a": a, "b": b})
    assert answer["relationship"] == expected
    assert answer["a"]["id"] == a
    assert answer["b"]["id"] == b


async def test_the_content_block_carries_the_same_answer(connect: Connect) -> None:
    """A client reading `content` rather than `structured_content` gets the answer too."""
    async with connect() as client:
        result = await client.call_tool(
            "relationship_between", {"a": "sally-baker", "b": "daisy-shaw"}
        )
    assert json.loads(text_of(result))["relationship"] == "aunt-or-uncle"


@pytest.mark.parametrize(
    ("name", "arguments"),
    [
        ("get_person", {"id": "nobody-at-all"}),
        ("relationship_between", {"a": "nobody-at-all", "b": "fred-shaw"}),
        ("relationship_between", {"a": "fred-shaw", "b": "nobody-at-all"}),
    ],
)
async def test_an_unknown_id_reaches_the_client_as_a_usable_error(
    connect: Connect, name: str, arguments: dict[str, str]
) -> None:
    """The message names the id, rather than being swallowed into a generic crash.

    The SDK replaces the text of any exception that is not a `ToolError` with
    "Error executing tool <name>". If `server.py` stopped translating
    `DataError`, this test would still see `is_error`, so it asserts on the
    text: the id has to survive the trip.
    """
    async with connect() as client:
        result = await client.call_tool(name, arguments)
    assert result.is_error is True
    assert "no person with id nobody-at-all" in text_of(result)


async def test_a_blank_search_reaches_the_client_as_a_usable_error(connect: Connect) -> None:
    async with connect() as client:
        result = await client.call_tool("find_people", {"query": "   "})
    assert result.is_error is True
    assert "query must not be blank" in text_of(result)


async def test_a_missing_argument_is_rejected_by_the_schema(connect: Connect) -> None:
    async with connect() as client:
        result = await client.call_tool("get_person", {})
    assert result.is_error is True
