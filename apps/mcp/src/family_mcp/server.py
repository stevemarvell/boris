"""The MCP server itself: three tools over one loaded `FamilyTree`.

The tools are thin. They turn an id into an answer by calling `queries.py`,
and they turn the two failures a client can act on — an unknown id, a blank
search — into `ToolError`, whose message reaches the client. Anything else
escaping a tool is treated as a crash, and the SDK deliberately replaces its
text with "Error executing tool <name>": the right treatment for a bug, and
the wrong one for "there is nobody with that id", which is why these two are
caught by name rather than left to arrive as a generic failure.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from api.tree import DataError, FamilyTree
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from family_mcp.queries import person_view, relationship_view, search
from family_mcp.relationships import RELATIONSHIP_TERMS

_TERMS = ", ".join(RELATIONSHIP_TERMS)

INSTRUCTIONS = f"""\
A family tree. Each person stores only their name, their parents and their
spouse; children, siblings, grandparents, cousins and generation are derived
on the way out, so the tree cannot contradict itself.

People are addressed by id. `find_people` turns a name fragment into ids,
`get_person` expands one id, and `relationship_between` names how one person
is related to another, always as one of: {_TERMS}.
"""

# Passed to the decorator rather than left as a docstring, because the
# vocabulary is built from RELATIONSHIP_TERMS: a docstring cannot interpolate,
# and a description that drifts from the list the tool can actually return is
# how a client learns to expect a term nothing will ever send it.
RELATIONSHIP_DESCRIPTION = f"""\
How person `a` is related to person `b`, in one word.

Both arguments are person ids, not names. The answer reads "a is b's ___", so
if `a` is `b`'s mother it is `parent`, and asking the other way round gives
`child`. It is always one of: {_TERMS}.

`unrelated` means no term in that list applies, which is wider than "no
connection": it covers in-laws, and blood relations more distant than the list
can name, such as a great-grandparent. It does not mean the two are strangers.
"""


@contextmanager
def _actionable() -> Iterator[None]:
    """Report the failures a client can act on as `ToolError`, with the reason."""
    try:
        yield
    except (DataError, ValueError) as err:
        raise ToolError(str(err)) from err


def build_server(tree: FamilyTree) -> MCPServer:
    """An `MCPServer` serving `tree`.

    Takes the tree rather than loading one, so a test can serve a tree it
    built and `main()` can serve the repository's.
    """
    server = MCPServer(name="family-tree", instructions=INSTRUCTIONS)

    @server.tool()
    def get_person(id: str) -> dict[str, Any]:
        """One person, with their derived relationships.

        `id` is a person id such as `fred-shaw`, not a name — use
        `find_people` to turn a name into one. Returns the person's name and
        generation, their spouse (or null), and their parents, children,
        siblings, grandparents and cousins. An empty list means the person has
        none of that relation; an unknown id is an error, never an empty
        answer.
        """
        with _actionable():
            return person_view(tree, id)

    @server.tool()
    def find_people(query: str) -> list[dict[str, str]]:
        """People whose name contains `query`, case-insensitive.

        Matches names only, not ids. Returns the id and name of each match,
        ordered by name; an empty list means nobody matched. A blank query is
        an error rather than the whole tree.
        """
        with _actionable():
            return search(tree, query)

    @server.tool(description=RELATIONSHIP_DESCRIPTION)
    def relationship_between(a: str, b: str) -> dict[str, Any]:
        with _actionable():
            return relationship_view(tree, a, b)

    return server


def main() -> None:
    """Serve the repository's family tree over stdio.

    An MCP client launches it as `uv run --directory apps/mcp family-tree-mcp`.
    The tree is read once, at startup: nothing here writes, and a change to
    `data/family.json` needs the server restarted to be seen.

    `FamilyTree.load()` finds `data/family.json` by walking up from the
    installed `api` package, or from `FAMILY_DATA` if that is set.
    """
    build_server(FamilyTree.load()).run()


if __name__ == "__main__":
    main()
