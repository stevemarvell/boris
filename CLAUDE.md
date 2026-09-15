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
| `apps/mcp/` | MCP server over the family tree. Reuses `api.tree.FamilyTree`; not deployed. |
| `apps/web/` | Ionic React app on Vite. Deploys to Vercel. |
| `data/` | The family tree itself, stored as files in this repository. |
| `docs/` | `adoption.md`, the ladder being climbed; `data-governance.md`, what the deployments and the credentialed CI jobs expose and why; `sops.md`, how agent work is run. |
| `manual/` | Reference manuals. `manual/web/` ships to Vercel, `manual/api/` into the API image. |

## Rules

- **`npm run verify` is the contract.** It runs ruff, pytest, typecheck,
  eslint, the web tests, and the build. Never report work as done until it
  passes — run it yourself rather than asking someone else to. A `Stop` hook
  runs it automatically when tracked files have changed, so a red loop blocks
  the turn rather than producing a claim.

- **Every behaviour change ships with a test.** A bug fix means a test that
  fails before the fix. A new feature means the happy path and the error path.
  A change that ends up with *fewer* tests than its base says so in the pull
  request body, in a line beginning `Removes tests:` — the `test census` check
  counts both sides and goes red without one.

- **Every change ships as a pull request.** Branch off `develop`, push the
  branch, then open a PR with `gh pr create --base develop`. Never commit or
  push directly to `develop` — a repository ruleset enforces this. Merge once
  `verify` is green. The branch is deleted on merge by GitHub
  (`delete_branch_on_merge`) — a repository setting, so it is recorded here
  rather than being visible in any file.

- **Decide and act; report after.** This rule used to end *stop and ask for
  anything destructive, outward-facing, or beyond what was asked*. That was
  retired on 2026-09-15 on the instruction "you are supposed to be autonomous".
  Pick the option you would have recommended, do it, and say what was done and
  why — a recommendation offered as a question is work handed back.

  What still stops is narrow, and the test is **recoverability, not scope**:
  work nobody can get back, money, or anything reaching a third party. A
  repository setting, a merged branch, a redeployed preview, an issue, a
  follow-up pull request — decide those, and record them in the pull request
  body. That is what makes the decision reviewable after the fact rather than
  unreviewable before it, and the two reviewers read that body. The line, what
  is on each side of it, and what this does *not* license: `docs/sops.md` SOP 6.

  Both reviewers still measure against this file, so a change of practice that
  is not written here reappears as a finding on every pull request until it is.
  That is the rule working: the file is the standard, not the conversation.

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

- **Every loop declares a maximum, and reports when it hits it.** No skill,
  command, or agent retries until it succeeds — an unbounded loop has no upper
  bound on cost, and three subagents have already been killed mid-task by
  session limits here. Reaching the ceiling means stop and say what failed;
  it is the procedure working, not a failure to hide. The declared ceilings,
  and an honest account of which are mechanically enforced and which are only
  discipline, are in `docs/sops.md`.

- **Work that needs a person is labelled, not attempted.** A dashboard behind
  a login, a subjective judgement, a purchase: label the issue `human` *and*
  `do not automate`, and assign it. An agent that meets one mid-task stops
  there and reports what remains. Also `docs/sops.md`.

- **Context is the budget.** Every request carries the whole conversation, so
  cost tracks context size rather than effort. Clear between unrelated tasks,
  keep this file under 200 lines with specialised knowledge in skills, and
  filter verbose output in a hook rather than reading it. `docs/sops.md` SOP 4
  has the order of operations; model choice is the smallest lever, not the
  first.

- **Known gaps live in GitHub issues, not in a file.** There was a
  `docs/BACKLOG.md`; it went stale exactly as it predicted it would, because
  nothing connected a merge to a line in it. Close an item the way the work
  closes it — a `Closes #<n>` line in a pull request body. Write that example
  with a placeholder, never a real number: #66 spelled one out to illustrate
  the rule and GitHub closed that issue on merge. Labels carry what the file's
  headings used to: `aia0`/`aia1`/`aia2` for the adoption step, `security` for
  exposure, and one of `critical`/`high`/`medium` for how bad it is and
  therefore when it gets done.

- **One scale ranks everything.** `critical`/`high`/`medium` carries both how
  bad a thing is and when it gets done. There is no second severity axis:
  two rankings drift apart, and the one in the label wins by default. Anything
  below `critical` is a claim that something bounds it — the issue says what,
  and what would void it. `docs/sops.md` SOP 5.

## Deployments

| What | Where | Built from |
| --- | --- | --- |
| API | <https://api-production-53f7b.up.railway.app> | `apps/api/Dockerfile`, Railway project `family-tree` |
| Web | Vercel project `family-tree` | root directory `apps/web`, deploys from `develop` |
| Docs | `/docs/` on the Vercel deployment | `scripts/build-docs.mjs`, run by the web `prebuild` |
| API manual | `/` on the Railway API | `manual/api/`, copied into the image |

There is no GitHub Pages entry any more. Pages on a private repository needs a
paid plan, so everything it published moved onto the two deployments above.

Several settings here are load-bearing, non-obvious, and were each learned by
something breaking quietly — which `railway.json` keys Railway honours, what
selects the Dockerfile, how `API_ENVIRONMENT`, `API_RATE_LIMIT` and
`VITE_API_URL` resolve, and how preview environments live and die.
**Read the `deployment` skill before changing anything that deploys.**

## Documentation

`/docs/` on Vercel carries the project documentation; the API serves its own
manual at its root. Adding a page touches six files and missing one means a
page that builds locally and 404s live — **read the `docs-site` skill**.

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

`API_ENVIRONMENT=development` opts back into the GraphQL IDE, introspection and
the manual's query console, all three off by default; omit it and the API
behaves exactly as in production. The `deployment` skill has the rest.

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

A branch gets a Vercel preview; a *pull request* gets a Railway environment too.
So a branch with no pull request open shares the production API — treat the
deployed API as shared state until one exists. Previews outlive the branches
they were built from, and only one of the two providers tears anything down:
the `deployment` skill has the lifecycle, and the retry for a stuck one.
