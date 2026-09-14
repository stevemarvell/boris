"""The MCP server itself: wires `family_mcp.tools` to MCP tool calls.

Run it directly (`python -m family_mcp.server`, or `uv run --directory
apps/mcp python -m family_mcp.server`) to serve over stdio, the transport an
MCP client spawns a server with by default.

Each registered tool catches `api.tree.DataError` and re-raises it as a
`ToolError`. That distinction matters here: this SDK (`mcp` 2.x) treats a
`ToolError` as an *anticipated* failure and keeps its message in the result
the client sees, but treats any other exception as a crash and replaces its
text with a generic "Error executing tool <name>" — so letting `DataError`
escape unchanged would turn "no person with id bogus-id" into a message that
does not say why. Catching it here is what makes an unknown id "an error a
client can act on" rather than a mystery.
"""

from typing import Any

from api.tree import DataError
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from family_mcp import tools
from family_mcp.tree_source import get_tree

server: MCPServer[None] = MCPServer(
    name="family-tree",
    description="Read-only access to this project's family tree.",
)


@server.tool()
def get_person(person_id: str) -> dict[str, Any]:
    """One person, with their derived relationships: parents, spouse,
    children, siblings, grandparents, cousins, and generation.

    `person_id` must be an existing person's id (for example
    "fred-shaw") — an unknown id is a tool error, not an empty result.
    """
    try:
        return tools.get_person(get_tree(), person_id)
    except DataError as err:
        raise ToolError(str(err)) from err


@server.tool()
def find_people(query: str) -> list[dict[str, str]]:
    """People whose name contains `query`, matched case-insensitively.
    An empty or unmatched query returns an empty list, not an error."""
    return tools.find_people(get_tree(), query)


@server.tool()
def relationship_between(a: str, b: str) -> str:
    """How person `a` is related to person `b`, as one term: self, spouse,
    parent, child, sibling, grandparent, grandchild, aunt-or-uncle,
    niece-or-nephew, cousin, or unrelated. Direction matters — if `a` is
    `b`'s mother, the answer is "parent", and swapping the arguments
    answers "child".

    Either id being unknown is a tool error, not an empty result.
    """
    try:
        return tools.relationship_between(get_tree(), a, b)
    except DataError as err:
        raise ToolError(str(err)) from err


if __name__ == "__main__":
    server.run()
