"""An MCP server over the family tree.

This package adds no family-tree logic of its own. Every derived fact — who
someone's children are, who their grandparents are, which generation they sit
in — comes from `api.tree.FamilyTree`, the same module `apps/api` uses to
answer GraphQL and REST. `pyproject.toml` depends on it as an editable path
dependency on `apps/api` rather than reimplementing any of it: a second
derivation would be a second thing to keep correct, and nothing would notice
if the two disagreed.

See `family_mcp.tools` for the three tools this server exposes, and
`family_mcp.relationships` for how `relationship_between` picks one term from
its fixed vocabulary.
"""
