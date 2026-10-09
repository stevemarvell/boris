# The application: shells, pending a replacement

What lives under `apps/` today is two deployable placeholder shells — no
application logic, no data. They exist so the live Vercel projects keep
building and smoke keeps passing while a real application is chosen.

The rules below are this application's. The AI layer's rules — the loop,
`verify`, pull requests, ceilings, issues — are in the root `CLAUDE.md` and
hold here too. The AI layer learns about this application only from
`project.json`; swapping the application means editing `apps/`, `project.json`
and this file.

## Layout

| Path | Holds |
| --- | --- |
| `api/` | FastAPI shell: `/health` (with the deployed commit), security headers, and Swagger UI, ReDoc and `/openapi.json` in development only. Deploys to Vercel. `smoke.sh` is its post-deploy checks. |
| `web/` | Ionic React shell on Vite, calling no API. Deploys to Vercel with the project documentation at `/docs/`. `scripts/` is its `prebuild` (the docs site); `smoke.sh` is its post-deploy checks. |
| `.claude/skills/` | This application's skills: `deployment`, `docs-site`. |

## Rules

- **Merging deploys.** `develop` publishes both Vercel projects. The approval
  path and the release path are the same.

- **Neither shell serves data.** `docs/data-governance.md` describes an
  application no longer served here; read it before adding anything that
  serves, stores, or exposes data, and rewrite it before any of that ships
  for real.

## Deployments

| What | Where | Built from |
| --- | --- | --- |
| API | <https://family-tree-api-stevemarvell-team.vercel.app> | Vercel project `family-tree-api`, root directory `apps/api` |
| Web | Vercel project `family-tree-web` | root directory `apps/web`, deploys from `develop` |
| Docs | `/docs/` on the web deployment | `apps/web/scripts/build-docs.mjs`, run by the web `prebuild` |

Both deployments are Vercel end to end. Their project names and URLs don't
describe what's here now — rename them when a real application replaces the
shells. The same names and URLs are in `project.json`, which is the copy the
AI layer reads. **Read the `deployment` skill before changing anything that
deploys.**

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
the dev server: a unit test runs in-process and structurally cannot see a
configuration failure that only shows up in a built, served bundle.
