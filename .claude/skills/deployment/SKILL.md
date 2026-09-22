---
name: deployment
description: The non-obvious settings behind this project's two Vercel deployments — how the API's [tool.vercel] entrypoint resolves, what its Root Directory has to be set to, how API_ENVIRONMENT and API_RATE_LIMIT behave, how VITE_API_URL is resolved, and why preview environments do not pair themselves. Read before changing anything that deploys, anything under apps/api, data/, manual/, or any build-time environment variable.
---

# Deploying this project

Every item here was learned by something breaking quietly, or measured
against a live deployment rather than assumed. None of it is guessable from
the code. Railway hosted the API until #126; it is retired, and the API is a
second, independent Vercel project now.

Four settings are load-bearing and non-obvious:

- The API's Vercel project (`family-tree-api`) has its **Root Directory** set
  to `apps/api` in the dashboard, the same way the web project's is
  `apps/web`. Confirmed from a real build log: Vercel clones the whole
  repository but then reads `apps/api/.python-version` and
  `apps/api/uv.lock`, and creates the virtualenv at
  `apps/api/.vercel/python/.venv` — all relative to that root, not the
  repository root. Vercel's own Python-framework detection plus
  `apps/api/pyproject.toml`'s `[tool.vercel]` table is the whole of the build
  config; `apps/api/vercel.json` carries only the `ignoreCommand` below.
- That `[tool.vercel]` table sets `entrypoint = "src.api.main:app"` — read
  relative to `apps/api/` (the Root Directory), not the repository root, which
  is why the path has the extra `src.` segment: the ASGI app object is at
  `apps/api/src/api/main.py`. Vercel checks the path exists at build time; it
  does not import the module to resolve it, so a mismatch fails the build with
  a clear message.
- Left alone, Vercel builds both projects on **every** push to every branch —
  production on `develop`, a preview everywhere else — whatever the push
  touched: 100 deployments in 30 hours, most of them identical. Each project's
  `vercel.json` sets an `ignoreCommand` running `scripts/vercel-ignore.mjs`,
  which diffs `VERCEL_GIT_PREVIOUS_SHA` (the last *successful* deployment, so
  never a skipped one) against `HEAD` over the paths that project reads, and
  skips when nothing changed. A branch's first push has no previous SHA, and
  Vercel's clone cannot fetch `develop` (no credentials — measured on #168),
  so it compares with the nearest squash-merge ancestor instead (`forkPoint`). Exit 0 means *skip*; every failure path
  exits 1 and builds. The path lists are in the script, and a new top-level
  directory rebuilds the web app until it is listed.
- `smoke.yml`'s commit gate (#50) accepts a deployed API whose `apps/api` is
  identical to the merged commit's, asking git with the script's own
  pathspecs (`node scripts/vercel-ignore.mjs paths api`), so a skipped build
  is not a stale one and the two cannot disagree about what the API reads.
  The web app has the same gate: `scripts/build-docs.mjs` publishes the
  build's `VERCEL_GIT_COMMIT_SHA` at `/docs/version.json`, and smoke diffs it
  over the web pathspecs.
- Vercel's Root Directory for the *web* project is `apps/web`. A `vercel.json`
  at the repository root is never read — Vercel looks for it inside each
  project's own root directory, which is why there are two.

- The API's `API_ENVIRONMENT` **Vercel project environment variable** gates
  the GraphQL IDE, introspection, and the API manual's query console (see
  `apps/api/src/api/main.py`). It defaults to `production` — all three off —
  so a variable nobody set fails closed rather than open. Local development
  sets `API_ENVIRONMENT=development` to get them back (see "Running it"
  below). The same default reaches preview deployments, which therefore serve
  the manual without its console; set `API_ENVIRONMENT=development` on the
  Vercel project (scoped to Preview, or to a specific branch) to get it back
  there, remembering that it opens GraphiQL and introspection too. The manual
  itself is served whole either way: production drops the console and says so
  in its place, rather than dropping the documentation with it.
- The API's `API_RATE_LIMIT` Vercel project environment variable sets the
  per-caller limit on `/graphql` (see `apps/api/src/api/limits.py`). Like
  `API_ENVIRONMENT` it defaults to a real value, `120/minute`, so a deployment
  nobody configured is still limited. Those counters are per *process*, and
  Vercel answers a burst with several (#128), so the ceiling that holds is the
  **Vercel WAF rule committed as `apps/api/firewall.json`**. It is not applied
  by a deploy. After changing the file, apply it by hand with
  `vercel firewall rules edit "Rate limit the tree" --json "$(node -e
  'process.stdout.write(JSON.stringify(require("./apps/api/firewall.json").rules[0]))')"
  --project family-tree-api --scope stevemarvell-team --yes`, then
  `vercel firewall publish` with the same flags. `API_RATE_LIMIT` does not
  change it, and `tests/test_firewall.py` goes red if the two disagree. Hobby
  allows one rate-limit rule per project. The caller is identified by `X-Vercel-Forwarded-For` (falling back to
  `X-Real-IP`, then `X-Forwarded-For`) — see `client_key`'s docstring in
  `apps/api/src/api/limits.py` for what was measured and why, since getting
  this wrong silently defeats the limit.

`VITE_API_URL` is read at build time by the *web* project. The two Vercel
projects are independent, and nothing syncs one project's URL into the
other's build — Railway's Vercel integration did that for `API_URL`, and
retired with it. `scripts/write-api-url.mjs` now has two cases: an explicit
`VITE_API_URL` (the e2e suite sets one) wins; otherwise the committed
`apps/web/.env.production` stands as the fallback — for every build,
production and every pull-request preview alike. See that script's own
comment, and "Preview environments" below, for why a preview does not get its
own paired API preview automatically, and where to find one on purpose.

## Preview environments

Every pull request that changes what the web app reads gets a Vercel preview
of it; one that touches only agent config, CI or tests gets none. The API project also
deploys a preview for that branch when the branch changes `apps/api` (the
ignore step skips it otherwise), but nothing wires the two together — see above. Find a specific pull
request's own API preview at its Vercel branch alias,
`family-tree-api-git-<branch>-stevemarvell-team.vercel.app` (slugified:
lowercase, non-alphanumeric runs collapsed to one hyphen), or via the Vercel
dashboard or `list_deployments` for the `family-tree-api` project — that is
the right target for verifying a change to `apps/api` itself, rather than the
production host every *web* preview actually calls.

**Vercel tears down neither kind of preview.** The preview deployment and its
branch alias survive the merge *and* the branch deletion — checked
2026-09-15, before Railway retired: 24 `family-tree-git-<branch>-…vercel.app`
previews were still serving `200` for branches whose pull requests had all
merged, one from a merge four minutes earlier. (Railway, while it hosted the
API, *did* remove its own PR environments on close — the one piece of
automatic cleanup this project had, and it went when Railway did.)

Nothing collects Vercel previews on this plan. Deployment Retention is a Pro
feature and the team is on Hobby, so the options are `vercel remove` or the
dashboard, both by hand. What *is* automated is the cause of new branches
piling up — `delete_branch_on_merge` is set on the repository — not the
previews themselves.

This is not an exposure. `docs/data-governance.md` records that previews are
open deliberately, because a reviewing agent has to be able to load one, and a
stale preview serves the same invented tree as production. It is worth
knowing because "the branch is gone" reads as "the preview is gone", and it is
not.
