# The application: a family tree

The rules below are this application's. The AI layer's rules — the loop,
`verify`, pull requests, ceilings, issues — are in the root `CLAUDE.md` and
hold here too. The AI layer learns about this application only from
`project.json` (#173); swapping the application means editing `apps/`,
`manual/web/`, `project.json` and this file.

## Layout

| Path | Holds |
| --- | --- |
| `api/` | FastAPI + Strawberry GraphQL service. Deploys to Vercel. `data/` (the family tree) and `manual/` (its reference manual) live inside it, not at the repository root, so that a Vercel project rooted at `apps/api` bundles both without reaching outside its own root directory (#126). `smoke.sh` is its post-deploy checks. |
| `mcp/` | MCP server over the family tree. Reuses `api.tree.FamilyTree`; not deployed. |
| `web/` | Ionic React app on Vite. Deploys to Vercel. `scripts/` is its `prebuild` (the docs site, the API URL); `smoke.sh` is its post-deploy checks. |
| `.claude/skills/` | This application's skills: `deployment`, `docs-site`. |
| `../manual/web/` | The web app's reference manual. Ships to Vercel with it. |

## Rules

- **A person is a name plus relationships, stored minimally.** Each person
  records only their parents and their spouse. Siblings, grandparents, cousins
  and children are *derived*, never stored — a file that can contradict itself
  will eventually contradict itself.

- **The deployed data is invented, and public on purpose.** The API is
  unauthenticated and the tree is one anonymous POST away, which is fine
  because `data/family.json` contains nobody. `docs/data-governance.md` records
  what is exposed, what bounds it, and the trigger that voids the decision:
  real data. Read it before adding anything that serves, stores, or exposes
  data — and before proposing authentication, because CORS has to move in the
  same change.

- **Merging deploys.** `develop` publishes both Vercel projects — the frontend
  and its docs, and the API and its manual. The approval path and the release
  path are the same.

## Deployments

| What | Where | Built from |
| --- | --- | --- |
| API | <https://family-tree-api-stevemarvell-team.vercel.app> | Vercel project `family-tree-api`, root directory `apps/api` |
| Web | Vercel project `family-tree-web` | root directory `apps/web`, deploys from `develop` |
| Docs | `/docs/` on the Vercel deployment | `apps/web/scripts/build-docs.mjs`, run by the web `prebuild` |
| API manual | `/` on the Vercel API | `apps/api/manual/`, bundled into the deployment |

Both deployments are Vercel end to end. GitHub Pages is not an option here —
paid-plan-only on a private repository. The same URLs and project names are
in `project.json`, which is the copy the AI layer reads.

Several settings here are load-bearing, non-obvious, and were each learned by
something breaking quietly — how the API's `[tool.vercel] entrypoint`
resolves, how `API_ENVIRONMENT`, `API_RATE_LIMIT` and `VITE_API_URL` resolve,
and how preview environments live and die. **Read the `deployment` skill
before changing anything that deploys.**

## Documentation

`/docs/` on Vercel carries the project documentation; the API serves its own
manual at its root. Adding a page touches six files and missing one means a
page that builds locally and 404s live — **read the `docs-site` skill**.

## Running it

```bash
npm install && npm run dev            # web app on http://localhost:5173
cd apps/api && API_ENVIRONMENT=development uv run uvicorn api.main:app --reload   # API on :8000
```

`API_ENVIRONMENT=development` opts back into the GraphQL IDE, introspection and
the manual's query console, all three off by default; omit it and the API
behaves exactly as in production. The `deployment` skill has the rest.

The e2e suite runs against the **built bundle** via `vite preview` and a **real
uvicorn**, never the dev server and never a mocked `fetch`. That is deliberate:
every failure this project has had — Railpack ignoring `railway.json`, Vercel
building the wrong directory, the Dockerfile not copying `data/`, CORS refusing
`127.0.0.1` — was configuration that unit tests structurally cannot reach.
