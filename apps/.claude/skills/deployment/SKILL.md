---
name: deployment
description: The non-obvious settings behind this project's two Vercel deployments — how the API's [tool.vercel] entrypoint resolves, what its Root Directory has to be set to, how API_ENVIRONMENT behaves, and how preview environments live and die. Read before changing anything that deploys, anything under apps/api, or any build-time environment variable.
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
  exits 1 and builds. What each build reads is declared in `project.json`
  (`reads`/`ignores` per app, #173). The lists say what a build reads, so an
  undeclared read skips a build it needed; smoke's freshness gates catch that.
- Smoke's freshness gate (#50, `scripts/smoke.mjs`) accepts a deployed app
  reporting the merged commit, or an older one whose build inputs are
  identical, asked of git with the ignore step's own pathspecs — so a skipped
  build is not a stale one and the two cannot disagree. Each app's
  `commitEndpoint` in `project.json` reports `VERCEL_GIT_COMMIT_SHA`: the
  API's `/health`, and the web app's `/docs/version.json`, written by
  `apps/web/scripts/build-docs.mjs`. Each app's own checks are its `smoke`
  script (`apps/api/smoke.sh`, `apps/web/smoke.sh`).
- Vercel's Root Directory for the *web* project is `apps/web`. A `vercel.json`
  at the repository root is never read — Vercel looks for it inside each
  project's own root directory, which is why there are two.

- The API's `API_ENVIRONMENT` **Vercel project environment variable** gates
  Swagger UI, ReDoc and `/openapi.json` (see `apps/api/src/api/main.py`). It
  defaults to `production`, which turns all three off, so a variable nobody set
  fails closed rather than open. Local development sets
  `API_ENVIRONMENT=development` to get them back.

The family tree was stripped in #195, and with it the rate limiter, the API
manual and `VITE_API_URL`: the web app calls no API. The Vercel WAF rule the
limiter relied on ("Rate limit the tree" on `family-tree-api`) was applied by
hand, not by a deploy, so it is still configured on Vercel and now matches only
paths that 404. Removing it is part of #194, which owns the Vercel projects.

## Preview environments

Every pull request that changes what the web app reads gets a Vercel preview
of it; one that touches only agent config, CI or tests gets none. The API project also
deploys a preview for that branch when the branch changes `apps/api` (the
ignore step skips it otherwise), but nothing wires the two together — see above. Find a specific pull
request's own API preview at its Vercel branch alias,
`family-tree-api-git-<branch>-stevemarvell-team.vercel.app` (slugified:
lowercase, non-alphanumeric runs collapsed to one hyphen), or via the Vercel
dashboard or `list_deployments` for the `family-tree-api` project. That is
the right target for verifying a change to `apps/api` itself.

**Vercel tears down neither kind of preview.** The preview deployment and its
branch alias survive the merge *and* the branch deletion — checked
2026-09-15, before Railway retired: 24 `family-tree-git-<branch>-…vercel.app`
previews were still serving `200` for branches whose pull requests had all
merged, one from a merge four minutes earlier. (Railway, while it hosted the
API, *did* remove its own PR environments on close — the one piece of
automatic cleanup this project had, and it went when Railway did.)

Vercel collects nothing on this plan (Deployment Retention is a Pro feature
and the team is on Hobby), so `.github/workflows/preview-prune.yml` does it:
when a pull request closes, it deletes that branch's previews in both
projects, using `VERCEL_TOKEN` (a team-scoped token, a repository secret,
expiring 2026-09-23 + one year). Run it by hand (`gh workflow run
preview-prune -f dry_run=false`) to delete every preview whose branch no longer
exists; the default `dry_run=true` only lists them. Its preview modes never
delete a production deployment or a `develop` build, whatever they are asked.

Production history is trimmed the same way: every merge makes a production
deployment and Vercel keeps them all, so each close (and each manual run) also
runs `vercel-prune.mjs history`. It keeps the deployment each app's alias
points at, and the newest `KEEP_PRODUCTION` (3) built ones for instant
rollback; it leaves any built deployment newer than the live one and anything still building (cancelled and failed records go whatever their age), and
deletes nothing if the alias lookup fails. `docs/data-governance.md` has why
the token is safe to hold.

This is not an exposure. `docs/data-governance.md` records that previews are
open deliberately, because a reviewing agent has to be able to load one, and a
stale preview serves nothing production does not. It is worth
knowing because "the branch is gone" reads as "the preview is gone", and it is
not.
