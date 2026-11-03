# The application: shells, pending a replacement

What lives under `apps/` today is two placeholder shells — no application
logic, no data, and neither deployed. They exist so `npm run verify` keeps
passing while a real application is chosen; nothing here is published
anywhere until `npm run deploy:add` says otherwise (see root `CLAUDE.md`'s
"Deployments and documentation").

This file belongs to the base repository and is never carried into a product:
each starter keeps its own `CLAUDE.md` inside its directory (`api/`, `web/`),
and `catalogue.json` at the root declares what a starter is. The rules below
are the base application's. The AI layer's rules — the loop,
`verify`, pull requests, ceilings, issues — are in the root `CLAUDE.md` and
hold here too. The AI layer learns about this application only from
`project.json`; swapping the application means editing `apps/`, `project.json`
and this file.

## Layout

| Path | Holds |
| --- | --- |
| `api/` | The `python-fastapi` starter: FastAPI shell with `/health`, security headers and the developer consoles in development only. Its own `CLAUDE.md` holds its rules and run commands. |
| `web/` | The `node-react` starter: Ionic React shell on Vite that builds the project documentation to `/docs/`. Its own `CLAUDE.md` holds its rules, and its `.claude/skills/` holds the `docs-site` skill. |

Each app also gets a `deployment` skill in its own `.claude/skills/`, once
`npm run deploy:add` has added one for it.

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
**Read the `deployment` skill under `apps/<app>/.claude/skills/` — written
by `deploy:add` into each app it deploys, from
`scripts/deploy/vercel/template/` — before changing anything that deploys,
once one exists.**

## Documentation

The web starter's build puts the project documentation at `/docs/` inside its
own bundle; it is reachable wherever the web app is deployed, and nowhere
while it isn't. **Read the `docs-site` skill** in `web/.claude/skills/` before
adding a page.

## Running it

Each starter's run commands are in its own `CLAUDE.md`. For the web app,
`npm install && npm run dev` serves it on http://localhost:5173; the API's
command is in `api/CLAUDE.md`.
