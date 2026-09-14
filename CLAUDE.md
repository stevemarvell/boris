# boris

A family tree application, built as a practice ground for climbing the stages in
`docs/adoption.md` — a rendering of the stages-of-agentic-adoption document
(Boris Cherny, Jul 2026). Each stage of the climb is deliberate; do not reach for
tooling that belongs to a later stage.

`index.html` at the root is the step-0 artifact. It used to be published by
GitHub Pages; it is now republished at `/docs/step-0.html` on the Vercel
deployment, along with the rest of the documentation — see "Documentation".

## Layout

| Path | Holds |
| --- | --- |
| `apps/api/` | FastAPI + Strawberry GraphQL service. Deploys to Railway. |
| `apps/web/` | Ionic React app on Vite. Deploys to Vercel. |
| `data/` | The family tree itself, stored as files in this repository. |
| `docs/` | `adoption.md`, the ladder being climbed; `data-governance.md`, what the deployments expose and why. |
| `manual/` | Reference manuals. `manual/web/` ships to Vercel, `manual/api/` into the API image. |

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

- **The deployed data is invented, and public on purpose.** The API is
  unauthenticated and the tree is one anonymous POST away, which is fine
  because `data/family.json` contains nobody. `docs/data-governance.md` records
  what is exposed, what bounds it, and the trigger that voids the decision:
  real data. Read it before adding anything that serves, stores, or exposes
  data — and before proposing authentication, because CORS has to move in the
  same change.

- **Merging deploys.** `develop` publishes the Vercel frontend and its docs,
  and the Railway API and its manual. The approval path and the release path
  are the same.

- **Deployment config lives in the repo, not in dashboards.** A setting only
  visible in a web console is invisible to everyone working here.

- **Known gaps live in GitHub issues, not in a file.** There was a
  `docs/BACKLOG.md`; it went stale exactly as it predicted it would, because
  nothing connected a merge to a line in it. Close an item the way the work
  closes it — a `Closes #<n>` line in a pull request body. Write that example
  with a placeholder, never a real number: #66 spelled one out to illustrate
  the rule and GitHub closed that issue on merge. Labels carry what the file's
  headings used to: `aia0`/`aia1`/`aia2` for the adoption step, `p1`/`p2`/`p3`
  for priority, `security` for exposure.

## Deployments

| What | Where | Built from |
| --- | --- | --- |
| API | <https://api-production-53f7b.up.railway.app> | `apps/api/Dockerfile`, Railway project `family-tree` |
| Web | Vercel project `family-tree` | root directory `apps/web`, deploys from `develop` |
| Docs | `/docs/` on the Vercel deployment | `scripts/build-docs.mjs`, run by the web `prebuild` |
| API manual | `/` on the Railway API | `manual/api/`, copied into the image |

There is no GitHub Pages entry any more. Pages on a private repository needs a
paid plan, so everything it published moved onto the two deployments this
project already has.

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
  `RAILWAY_GIT_COMMIT_SHA` so `smoke` can catch it if that drifts again.
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

## Documentation

Everything GitHub Pages used to publish is now served by the two deployments
this project already had. Nothing is hosted anywhere a private repository
cannot reach.

| URL | Source | Carried by |
| --- | --- | --- |
| `/docs/` | `scripts/build-docs.mjs` | Vercel |
| `/docs/adoption.html` | `docs/adoption.md` | Vercel |
| `/docs/data-governance.html` | `docs/data-governance.md` | Vercel |
| `/docs/manual/web/` | `manual/web/` | Vercel |
| `/docs/step-0.html` | `index.html` | Vercel |
| `/` on the API | `manual/api/` | the API image |

The web app's `prebuild` runs `scripts/build-docs.mjs`, which renders the
Markdown with `scripts/markdown.mjs` and writes `apps/web/public/docs/`. That
directory is generated, gitignored, and deleted on every run — edit the
sources, never the output.

The API manual is the one that does **not** go to Vercel. It ships inside the
API image and is mounted at the service root, so:

- its "try it" console, where `API_ENVIRONMENT=development` enables it, posts
  to `/graphql` on the origin it was loaded from, which means a pull request
  environment's manual exercises *that* API rather than production's;
- it needs no CORS allowance at all, which is why `stevemarvell.github.io` is
  no longer in `ALLOWED_ORIGIN_REGEX`.

The mount is a catch-all at `/`, registered after `/graphql` and `/health` so
those still win. A missing manual disables the mount rather than failing
startup; `smoke` fetches it after every merge, so a build that drops it fails
there instead.

## Running it

**Editing dependencies needs npm 11.** npm 10 cannot resolve `vitest` 4's
optional peer set — its arborist crashes with *"Cannot read properties of
null (reading 'edgesOut')"* on `npm install`, `npm install --workspace` and
`npm ci` alike. The committed lockfile was regenerated with `npx npm@11`, is
still lockfileVersion 3, and `npm ci` reads it fine under npm 10 — which is
what CI runs. But if you change a dependency, do the lock step with
`npx npm@11 install`.

```bash
npm install && npm run dev            # web app on http://localhost:5173
cd apps/api && API_ENVIRONMENT=development uv run uvicorn api.main:app --reload   # API on :8000
```

`API_ENVIRONMENT=development` opts back into the GraphQL IDE at `/graphql`,
schema introspection, and the query console in the manual at `/`, all three off
by default. Omit it and the API behaves exactly as it does in production. The
manual itself is served whole either way — production drops the console and
says so in its place, rather than dropping the documentation.

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
