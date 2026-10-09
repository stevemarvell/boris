---
name: sync-ai-layer
description: Keeping the AI layer identical between boris (the master) and a repository built from it — which files are shared, which stay per repository, and how to bring improvements up from a downstream repository before syncing down. Use when asked to sync, compare or reconcile .claude/, the SOPs or CLAUDE.md with boris or with a repository built from it.
---

# Syncing the AI layer

boris is the master copy of the AI layer. A repository built from it keeps the
shared files byte-identical, so a sync is a copy and a diff check, not a merge
of prose. Improvements found downstream come **up** to boris first, then go
back **down** — never edited only in the downstream copy.

## What is shared

Copied verbatim, every file:

- `.claude/agents/`, `.claude/commands/`, `.claude/hooks/`, `.claude/skills/`,
  `.claude/statusline.mjs`, `.claude/statusline.d.mts`
- `docs/sops.md`
- `scripts/*.mjs`, `scripts/*.d.mts`, and `scripts/test/` — including
  `scripts/labels.mjs`
- `labels.json` at the repository root: the one source of truth for label
  names, colours and descriptions, applied by `scripts/labels.mjs`
- `.github/workflows/`, except anything that names a repository or project

And one block of `CLAUDE.md`: everything between `<!-- shared:begin` and
`<!-- shared:end -->`.

## What stays per repository

- `CLAUDE.md` outside the shared block: the intro, *Layout*, *Repository
  settings*, *Deployments and documentation*, and any rule that belongs to
  the application (an acceptance-criteria convention, say).
- `apps/`, including `apps/CLAUDE.md` and `apps/.claude/skills/`.
- `project.json`, `README.md`, `docs/data-governance.md`, `docs/adoption.md`
  if the repository has one, `.claude/settings.json` (its permissions are
  per-repository, and an agent may not edit it — SOP 7), `.claude/trials/`.

A shared file never names the repository it sits in (naming boris as the
master is fine — that is the same everywhere). If a file has to, it isn't
shared.

## Procedure

Ceiling: one pass. Anything still different after it is reported, not looped
on.

1. **Measure.** For every shared path, diff boris against the downstream
   repository (`git diff --no-index --numstat`). Byte-identical files need
   nothing.
2. **Classify each differing hunk:** generic (it belongs in the master),
   downstream-only (application content that leaked into a shared file — move
   it out of the shared file), or stale (the downstream copy is behind).
   Read the downstream repository's own log of findings if it keeps one.
3. **Up first.** Generic downstream improvements go into boris in a pull
   request, with any test that came with them. Strip incident narrative and
   the downstream repository's name as they come up.
4. **Then down.** Copy every shared file from boris's `develop`, replace the
   shared block of its `CLAUDE.md`, run `npm run verify` there, and run
   `node scripts/labels.mjs --repo <downstream>` so the downstream repository's
   labels match `labels.json`. Open a pull request; its body lists any file
   that is still intentionally different, and why.
5. **Check.** After both merge, re-run step 1: only the per-repository files
   above may still differ.
