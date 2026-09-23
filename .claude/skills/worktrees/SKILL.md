---
name: worktrees
description: How parallel agent work stays isolated in this repository — creating a worktree, what npm run bootstrap installs per-worktree, how end-to-end ports are derived so checkouts never collide, and why a branch's Vercel previews do not pair themselves. Read before starting a new worktree, touching scripts/ports.mjs, or debugging an e2e port clash or a stuck preview.
---

# Worktrees

Each agent works in its own worktree, so parallel work cannot collide:

```bash
git worktree add ../boris-<name> -b feat/<name>
cd ../boris-<name> && npm run bootstrap
```

`node_modules` and `.venv` are per-worktree, not shared — `npm run bootstrap`
installs both toolchains and the Playwright browser.

## Ports

End-to-end ports are derived from the worktree directory name by
`scripts/ports.mjs`, so two checkouts never fight over a port. Set
`E2E_API_PORT` and `E2E_WEB_PORT` to override.

## Previews

A branch gets a Vercel preview of the web app and, separately, one of the API
— each only when the branch changes what that project reads (the
`deployment` skill has the ignore step) — but a web build never reads its own
branch's API preview: `VITE_API_URL` always resolves to the one production
API, so a branch with no pull request open is no different from one with one.
Vercel tears down neither kind of preview; the `preview-prune` workflow
deletes a branch's previews when its pull request closes — the `deployment`
skill has the lifecycle, and why.
