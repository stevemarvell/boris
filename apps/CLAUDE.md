# The application: shells, pending a replacement

The family tree that lived here was stripped in #195. The last commit that had
it is tagged `family-tree-final`. What remains are two deployable shells, kept
so the live Vercel projects keep building and smoke keeps passing until #194
decides their fate.

The rules below are this application's. The AI layer's rules — the loop,
`verify`, pull requests, ceilings, issues — are in the root `CLAUDE.md` and
hold here too. The AI layer learns about this application only from
`project.json` (#173); swapping the application means editing `apps/`,
`manual/web/`, `project.json` and this file.

## Layout

| Path | Holds |
| --- | --- |
| `api/` | FastAPI shell: `/health` (with the deployed commit), security headers, and Swagger UI, ReDoc and `/openapi.json` in development only. Deploys to Vercel. `smoke.sh` is its post-deploy checks. |
| `web/` | Ionic React shell on Vite, calling no API. Deploys to Vercel with the project documentation at `/docs/`. `scripts/` is its `prebuild` (the docs site); `smoke.sh` is its post-deploy checks. |
| `.claude/skills/` | This application's skills: `deployment`, `docs-site`. |
| `../manual/web/` | The web app's reference manual. Still documents the family tree; #194 owns it. Ships to Vercel with the web app. |

## Rules

- **Merging deploys.** `develop` publishes both Vercel projects. The approval
  path and the release path are the same.

- **Neither shell serves data.** `docs/data-governance.md` still describes the
  family tree's exposure until #194 rewrites it. Read it before adding anything
  that serves, stores, or exposes data.

## Deployments

| What | Where | Built from |
| --- | --- | --- |
| API | <https://family-tree-api-stevemarvell-team.vercel.app> | Vercel project `family-tree-api`, root directory `apps/api` |
| Web | Vercel project `family-tree-web` | root directory `apps/web`, deploys from `develop` |
| Docs | `/docs/` on the web deployment | `apps/web/scripts/build-docs.mjs`, run by the web `prebuild` |

Both deployments are Vercel end to end, and still carry the family tree's
names; #194 decides whether they are renamed, repurposed or removed. The same
URLs and project names are in `project.json`, which is the copy the AI layer
reads. **Read the `deployment` skill before changing anything that deploys.**

## Documentation

`/docs/` on Vercel carries the project documentation. Adding a page touches
six files and missing one means a page that builds locally and 404s live —
**read the `docs-site` skill**.

## Running it

```bash
npm install && npm run dev            # web app on http://localhost:5173
cd apps/api && API_ENVIRONMENT=development uv run uvicorn api.main:app --reload   # API on :8000
```

`API_ENVIRONMENT=development` opts back into Swagger UI, ReDoc and
`/openapi.json`, all three off by default.

The web e2e suite runs against the **built bundle** via `vite preview`, never
the dev server: every deployment failure this project has had was
configuration that unit tests structurally cannot reach.
