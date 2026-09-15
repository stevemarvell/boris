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
  The manual itself is served whole either way: production drops the console
  and says so in its place, rather than dropping the documentation with it.
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
`api-boris-pr-<number>.up.railway.app`.

**Only one of the two is actually torn down.** Railway removes its environment
when the pull request closes — checked on 2026-09-15, every
`api-boris-pr-<n>/health` for #97, #98, #108, #110, #111, #112 and #114 returns
`404`. Vercel removes nothing. The preview deployment and its
`family-tree-git-<branch>-…vercel.app` alias survive the merge *and* the branch
deletion: the same check found 24 of them still serving `200`, for branches
whose pull requests had all merged, one of them from a merge four minutes
earlier.

Nothing collects them on this plan. Deployment Retention is a Pro feature and
the team is on Hobby, so the options are `vercel remove` or the dashboard, both
by hand. What *is* automated is the cause — `delete_branch_on_merge` is set on
the repository, so branches no longer pile up even though their previews do.

This is not an exposure. `docs/data-governance.md` records that previews are
open deliberately, because a reviewing agent has to be able to load one, and a
stale preview serves the same invented tree as production. It is worth knowing
because "the branch is gone" reads as "the preview is gone", and it is not.

### A failed PR deployment, and why retrying it leaves the check red

The `family-tree - api` status can fail for Railway's own reasons. It did on
#115: the image built (the same Dockerfile the `image` job builds green on
every run) and the deploy step failed, on a pull request that changed two
Markdown files.

`railway redeploy` fixes it and **does not clear the status**. The retry:

```bash
railway link --project 51b91279-9dfc-4a65-83c2-630caa6d480c \
  --environment boris-pr-<number> --service api
railway redeploy --service api --yes
```

`redeploy` takes no `--environment`, so the `link` is what selects it. After
that succeeded, `api-boris-pr-115/health` returned `200` with the branch's own
commit — and the GitHub commit status still read *Deployment failed*, because
Railway posts it from the GitHub integration and a CLI deploy is not that.

So a red `family-tree - api` means "check the environment", not "the branch is
broken". Curl the health endpoint before believing it. `verify` remains the
only required check, which is why one status stuck on a stale failure does not
block a merge.

They do **not** pair themselves. The Railway integration syncs the *production*
environment's `API_URL` into Vercel for previews as well as production, so a
preview frontend would be built against production and show production's data.
`scripts/write-api-url.mjs` closes that by reading Vercel's
`VERCEL_GIT_PULL_REQUEST_ID` and pointing the build at that PR's own API. The
host pattern is a Railway convention rather than a contract; override it with
`RAILWAY_PR_API_TEMPLATE` if it changes.
