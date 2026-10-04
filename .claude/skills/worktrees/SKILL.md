---
name: worktrees
description: How parallel agent work stays isolated in this repository — creating a worktree, what npm run bootstrap installs per-worktree, how end-to-end ports are derived so checkouts never collide, how previews behave per branch, and how to clean worktrees up afterwards. Read before starting a new worktree, cleaning old ones up, touching scripts/ports.mjs, or debugging an e2e port clash.
---

# Worktrees

Each agent works in its own worktree, so parallel work cannot collide. Claude
Code makes them under `.claude/worktrees/` (`EnterWorktree`, or the Agent tool
with `isolation: "worktree"`); by hand:

```bash
git worktree add ../<repo>-<name> -b feat/<name>   # <repo>: this repository's folder name
cd ../<repo>-<name> && npm run bootstrap
```

`node_modules` and `.venv` are per-worktree, not shared — `npm run bootstrap`
installs both toolchains and the Playwright browser.

## Ports

End-to-end ports are derived from the worktree directory name by
`scripts/ports.mjs`, so two checkouts never fight over a port. The app's e2e
config names the servers it needs (`ports(['api', 'web'])`), and each gets
its own band; set `E2E_<NAME>_PORT` (e.g. `E2E_API_PORT`) to override one.

## Previews

A branch gets a Vercel preview of each deployed app only when it changes what
that app reads (`scripts/vercel-ignore.mjs`). Each app's preview is
independent: nothing pairs a branch's web preview with its API preview, so
which API a web preview calls is the application's business — its
`deployment` skill under `apps/.claude/skills/` says. Vercel tears no preview
down; the `preview-prune` workflow deletes a branch's previews when its pull
request closes.

## Cleaning up

Every worktree here was made by a Claude session or one of its agents —
`.claude/worktrees/*` and any `../<repo>-*` sibling alike. None is someone
else's to leave alone. Audit them all, then remove what is finished.

Before removing one, establish it is recoverable — by command, not by eye
(SOP 6):

- `git -C <worktree> status --short` — uncommitted files are the only thing
  git cannot give back. If there are any, check each against git
  (`git hash-object <file>` then `git cat-file -e <hash>`) before deciding.
- its branch's pull request is `MERGED`, or its tip is already on `develop`.

Then:

```bash
git worktree remove <path>        # add --force once the audit says it is safe
git branch -D <branch>            # -D: a squash merge never looks merged to git
git worktree list                 # confirm
```

On Windows `git worktree remove` can unregister the worktree and still fail
with "Permission denied" on its directory or on `.git/worktrees/<name>`. Once
nothing holds files there, plain `rm -rf` on both finishes the job;
`git worktree prune` alone often hits the same error.
