---
name: deployment
description: The non-obvious settings behind this project's Railway and Vercel deployments — which railway.json keys are honoured and which are ignored, what selects the Dockerfile, how API_ENVIRONMENT and API_RATE_LIMIT behave, how VITE_API_URL is resolved, and why preview environments do not pair themselves. Read before changing anything that deploys, anything under apps/api, data/, manual/api/, railway.json, or any build-time environment variable.
---

# Deploying this project

Every item here was learned by something breaking quietly. None of it is
guessable from the code.

Five settings are load-bearing and non-obvious:

- Railway ignores `railway.json`'s `builder` field. Railpack reads the root
  `package.json`, concludes the repo is Node, and fails with *"No start command
  detected"* without looking for a Dockerfile. The `RAILWAY_DOCKERFILE_PATH`
  service variable is what actually selects it.
- Railway *does* honour `railway.json`'s `watchPatterns`, unlike `builder` —
  so the two keys next to each other behave differently, and the only way to
  know which is which is to test it. Measured on a pull request environment: a
  commit changing only `manual/api/` did not redeploy under
  `["apps/api/**"]` and did redeploy once `manual/api/**` was added. The list
  must therefore name every path `apps/api/Dockerfile` copies — `apps/api/`,
  `data/`, and `manual/api/` — or a change to the family tree or the manual
  deploys nothing and says nothing. `/health` reports
  `RAILWAY_GIT_COMMIT_SHA` so `smoke` can catch it if that drifts again —
  and `smoke` only demands a match when the push actually touched one of
  those paths, because most merges here change docs or the web app and
  correctly leave the API where it was.
- Vercel's Root Directory is `apps/web`, set in the dashboard. That means a
  `vercel.json` at the repository root is never read — Vercel looks for it
  inside the root directory. Put Vercel config in `apps/web/`.
- The API's `API_ENVIRONMENT` Railway service variable gates the GraphQL IDE,
  introspection, and the API manual's query console (see
  `apps/api/src/api/main.py`). It defaults to `production` — all three off —
  so a variable nobody set fails closed rather than open; it is never set on
  Railway, since the deployed API should always behave this way. Local
  development sets `API_ENVIRONMENT=development` to get them back (see
  "Running it" below). The same default reaches pull request environments,
  which therefore serve the manual without its console; set
  `API_ENVIRONMENT=development` on the pull request environment to get it
  back there, remembering that it opens GraphiQL and introspection too.
- The API's `API_RATE_LIMIT` service variable sets the per-caller limit on
  `/graphql` (see `apps/api/src/api/limits.py`). Like `API_ENVIRONMENT` it is
  never set on Railway and defaults to a real value, `120/minute`, so a
  deployment nobody configured is still limited. Counters are per process and
  in memory, so they reset on every deploy and every wake from
  `sleepApplication` — a ceiling on abuse, not a quota. The caller is
  identified by `X-Real-IP`, because Railway's edge is a pool and the last
  `X-Forwarded-For` hop names the edge node rather than the caller; keying on
  that hop silently multiplies the limit by the size of the pool.

`VITE_API_URL` is read at build time. The Railway integration syncs the API
service's `API_URL` variable into Vercel, and `scripts/write-api-url.mjs` maps
it onto `VITE_API_URL` before the build — so a deployment points at whichever
Railway environment it belongs to rather than at a hardcoded host. Precedence:
an explicit `VITE_API_URL` (the e2e suite sets one) wins, then `API_URL`, then
the committed `apps/web/.env.production` as a fallback.

On Railway, `API_URL` is defined as `https://${{RAILWAY_PUBLIC_DOMAIN}}`, so it
resolves per environment rather than being typed out.

## Preview environments

Every pull request gets both a Vercel preview and a Railway PR environment at
`api-boris-pr-<number>.up.railway.app`, and they are torn down on merge.

They do **not** pair themselves. The Railway integration syncs the *production*
environment's `API_URL` into Vercel for previews as well as production, so a
preview frontend would be built against production and show production's data.
`scripts/write-api-url.mjs` closes that by reading Vercel's
`VERCEL_GIT_PULL_REQUEST_ID` and pointing the build at that PR's own API. The
host pattern is a Railway convention rather than a contract; override it with
`RAILWAY_PR_API_TEMPLATE` if it changes.
