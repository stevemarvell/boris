# boris

A family tree application, built as a practice ground for climbing the stages in
`docs/adoption.md` — a rendering of the stages-of-agentic-adoption document
(Boris Cherny, Jul 2026). Each stage of the climb is deliberate; do not reach for
tooling that belongs to a later stage.

`index.html` at the root is the step-0 artifact, published at
<https://stevemarvell.github.io/boris/> by GitHub Pages from `develop`.

## Layout

| Path | Holds |
| --- | --- |
| `apps/api/` | FastAPI + Strawberry GraphQL service. Deploys to Railway. |
| `apps/web/` | Ionic React app on Vite. Deploys to Vercel. |
| `data/` | The family tree itself, stored as files in this repository. |
| `docs/` | `adoption.md`, the ladder being climbed. |

## Rules

- **`npm run verify` is the contract.** It runs ruff, pytest, typecheck,
  eslint, the web tests, and the build. Never report work as done until it
  passes — run it yourself rather than asking someone else to. A `Stop` hook
  runs it automatically when tracked files have changed, so a red loop blocks
  the turn rather than producing a claim.

- **Every behaviour change ships with a test.** A bug fix means a test that
  fails before the fix. A new feature means the happy path and the error path.

- **Every change ships as a pull request.** Branch off `develop`, push the
  branch, then open a PR with `gh pr create --base develop`. Never commit or
  push directly to `develop` — a repository ruleset enforces this. Merge once
  `verify` is green; stop and ask for anything destructive, outward-facing, or
  beyond what was asked.

- **`docs/adoption.md` preserves the source wording.** It is a rendering of the
  original document, not a rewrite. Restructure the layout freely, but do not
  reword, summarise, or drop content, and keep every link intact.

- **A person is a name plus relationships, stored minimally.** Each person
  records only their parents and their spouse. Siblings, grandparents, cousins
  and children are *derived*, never stored — a file that can contradict itself
  will eventually contradict itself.

- **Merging deploys.** `develop` publishes the Pages site, the Vercel frontend,
  and the Railway API. The approval path and the release path are the same.

- **Deployment config lives in the repo, not in dashboards.** A setting only
  visible in a web console is invisible to everyone working here.

## Deployments

| What | Where | Built from |
| --- | --- | --- |
| Step-0 page | <https://stevemarvell.github.io/boris/> | `index.html`, Pages, `develop` |
| API | <https://api-production-53f7b.up.railway.app> | `apps/api/Dockerfile`, Railway project `family-tree` |
| Web | Vercel project `family-tree` | root directory `apps/web`, deploys from `develop` |

Two settings are load-bearing and non-obvious:

- Railway ignores `railway.json`'s `builder` field. Railpack reads the root
  `package.json`, concludes the repo is Node, and fails with *"No start command
  detected"* without looking for a Dockerfile. The `RAILWAY_DOCKERFILE_PATH`
  service variable is what actually selects it.
- Vercel's Root Directory is `apps/web`, set in the dashboard. That means a
  `vercel.json` at the repository root is never read — Vercel looks for it
  inside the root directory. Put Vercel config in `apps/web/`.

`VITE_API_URL` is read at build time and set in `apps/web/.env.production`. It
is a public URL, not a secret.

## Running it

```bash
npm install && npm run dev            # web app on http://localhost:5173
cd apps/api && uv run uvicorn api.main:app --reload   # API on :8000
```

```bash
npm run verify        # everything, about a minute
npm run verify:api    # ruff + pytest
npm run verify:web    # typecheck + eslint + vitest + build
npm run verify:e2e    # playwright against the built bundle and a real uvicorn
```

CI runs `verify` on every pull request and on pushes to `develop`, and the
branch ruleset requires it to pass before a merge. A red loop cannot land.

The e2e suite runs against the **built bundle** via `vite preview` and a **real
uvicorn**, never the dev server and never a mocked `fetch`. That is deliberate:
every failure this project has had — Railpack ignoring `railway.json`, Vercel
building the wrong directory, the Dockerfile not copying `data/`, CORS refusing
`127.0.0.1` — was configuration that unit tests structurally cannot reach.

A `smoke` workflow runs after each merge to `develop` and checks the deployed
API and web app, allowing for Railway's cold start. Claude Code Review comments
on every pull request; it is advisory, and `verify` is the only required check.

## Worktrees

Each agent works in its own worktree, so parallel work cannot collide:

```bash
git worktree add ../boris-<name> -b feat/<name>
cd ../boris-<name> && npm run bootstrap
```

`node_modules` and `.venv` are per-worktree, not shared — `npm run bootstrap`
installs both toolchains and the Playwright browser.

End-to-end ports are derived from the worktree directory name by
`scripts/ports.mjs`, so two checkouts never fight over a port. Set
`E2E_API_PORT` and `E2E_WEB_PORT` to override.

Vercel builds a preview for every branch. Railway does not — every worktree
shares one API until PR environments exist, so treat the deployed API as shared
state.
