# The application: shells, pending a replacement

What lives under `apps/` today is two placeholder shells — no application
logic, no data, and neither deployed. They exist so `npm run verify` keeps
passing while a real application is chosen; nothing here is published
anywhere until `npm run deploy:add` says otherwise (see root `CLAUDE.md`'s
"Deployments and documentation").

The rules below are this application's. The AI layer's rules — the loop,
`verify`, pull requests, ceilings, issues — are in the root `CLAUDE.md` and
hold here too. The AI layer learns about this application only from
`project.json`; swapping the application means editing `apps/`, `project.json`
and this file.

## Layout

| Path | Holds |
| --- | --- |
| `api/` | FastAPI shell: `/health` (with the deployed commit, once deployed), security headers, and Swagger UI, ReDoc and `/openapi.json` in development only. `smoke.sh` is its post-deploy checks. |
| `web/` | Ionic React shell on Vite, calling no API. Builds the project documentation to `/docs/` (`scripts/` is its `prebuild`). `smoke.sh` is its post-deploy checks. |
| `.claude/skills/` | This application's skills: `docs-site`, and `deployment` once `npm run deploy:add` has added one. |

## Rules

- **Nothing here is deployed by default.** `npm run verify` is what keeps
  both shells green; there is no Vercel project building either until
  `npm run deploy:add -- vercel --app <app> ...` adds one. Once an app is
  deployed, merging to `develop` publishes it — the approval path and the
  release path are the same.

- **Neither shell serves data.** `docs/data-governance.md` describes an
  application no longer served here; read it before adding anything that
  serves, stores, or exposes data, and rewrite it before any of that ships
  for real.

## Deployments

| What | Where | Built from |
| --- | --- | --- |
| API | Not deployed. | `apps/api`, once `npm run deploy:add -- vercel --app api ...` adds a `deploy` block for it. |
| Web | Not deployed. | `apps/web`, once `npm run deploy:add -- vercel --app web ...` adds a `deploy` block for it. |
| Docs | Not published. | `apps/web/scripts/build-docs.mjs` builds `/docs/` into the web app's own bundle; it is reachable once the web app is deployed. |

`project.json` is the AI layer's own copy of which apps are deployed, read
through `scripts/project.mjs`. Nothing is deployed there either, by default.
**Read the `deployment` skill under `apps/.claude/skills/` — written by
`deploy:add` from `scripts/deploy/vercel/template/` — before changing
anything that deploys, once one exists.**

## Documentation

The web app's build puts the project documentation at `/docs/` inside its own
bundle; it is reachable wherever the web app is deployed, and nowhere while
it isn't. Adding a page touches six files and missing one means a page that
builds locally and 404s wherever it is live — **read the `docs-site` skill**.

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
