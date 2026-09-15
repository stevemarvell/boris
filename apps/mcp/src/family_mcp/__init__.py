"""An MCP server over the family tree in `data/family.json`.

Every relationship it reports is derived by `api.tree.FamilyTree`, the same
code the GraphQL and REST APIs use. Nothing here re-implements "who counts as
a sibling": a second derivation would be a second thing to keep correct, and
nothing would say so when the two disagreed.
"""
