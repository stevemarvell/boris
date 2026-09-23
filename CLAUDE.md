# boris

A practice ground for climbing the steps in
`docs/adoption.md` — a rendering of *Steps of AI Adoption* (Boris Cherny,
Jul 2026). Each step of the climb is deliberate; do not reach for tooling that
belongs to a later step.

The repository is two layers (#173). **The AI layer** — `.claude/`,
`scripts/`, `.github/`, `telemetry/`, and this file — is the loop: verify,
review, isolate, deploy, smoke, triage. **The application** — `apps/`, today a
family tree — is what the loop works on. The AI layer learns about the
application only from `project.json`. The application's own rules, layout,
deployments and run commands are in **`apps/CLAUDE.md`**; read it before
working under `apps/`.

`index.html` at the root is the step-0 artifact. It is published at
`/docs/step-0.html` on the Vercel deployment, along with the rest of the
documentation — see `apps/CLAUDE.md`.

## Layout

| Path | Holds |
| --- | --- |
| `apps/` | The application, with its own `CLAUDE.md`. |
| `project.json` | The one place the AI layer (`.claude/`, `scripts/`, `.github/`) learns about the apps: paths, toolchains, build inputs, Vercel projects (#173). Read through `scripts/project.mjs`. |
| `docs/` | `adoption.md`, the ladder being climbed; `data-governance.md`, what the deployments and the credentialed CI jobs expose and why; `sops.md`, how agent work is run; `extraction.md`, what here is reusable on another project and what is a conclusion that must not be copied. |
| `manual/web/` | The web app's reference manual (see `apps/CLAUDE.md`). |

## Rules

- **`npm run verify` is the contract.** It runs the AI layer's own tests, then
  every app's own `verify` commands from `project.json`. Never report work as done until it
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

- **Decide and act; report after.** The test is **recoverability, not scope**:
  stop for work nobody can get back, for money, and for anything reaching a
  third party. Everything else is decided, done, and recorded in the pull
  request body where the reviewers read it. Recoverable is established by a
  command, not by eye. `docs/sops.md` SOP 6.

- **`docs/adoption.md` preserves the source wording.** It is a rendering of the
  original document, not a rewrite. Restructure the layout freely, but do not
  reword, summarise, or drop content, and keep every link intact.

- **Deployment config lives in the repo, not in dashboards.** A setting only
  visible in a web console is invisible to everyone working here.

- **Every loop declares a maximum, and reports when it hits it.** No skill,
  command, or agent retries until it succeeds — an unbounded loop has no upper
  bound on cost, and three subagents have been killed mid-task by session
  limits here. Reaching the ceiling means stop and say what failed; it is the
  procedure working, not a failure to hide. The declared ceilings, and an
  honest account of which are mechanically enforced and which are only
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

- **Known gaps live in GitHub issues, not in a file.** A backlog file goes
  stale, because nothing connects a merge to a line in it. Close an item the
  way the work closes it — a `Closes #<n>` line in a pull request body. Write
  that example with a placeholder, never a real number: spelling one out to
  illustrate the rule closes that issue on merge. Where the issue's done-when
  is confirmation *outside* the repository, `Closes` belongs on the pull
  request that confirms, not the one that fixes — merging a fix is not
  evidence it worked. #60 wanted CI metrics found in Grafana Cloud and
  auto-closed on the fix's merge, two pull requests before anyone could look;
  the fix happened to be right, and nothing about the merge said so. Labels
  carry the structure: `aia0`/`aia1`/`aia2` for the adoption step, `security`
  for exposure, and one of `critical`/`high`/`medium` for how bad it is and
  therefore when it gets done.

- **One scale ranks everything.** `critical`/`high`/`medium` carries both how
  bad a thing is and when it gets done. There is no second severity axis: two
  rankings drift apart, and the one in the label wins by default. The same goes
  for any fact written in two places. Anything below `critical` is a claim that
  something bounds it — the issue says what, and what would void it.
  `docs/sops.md` SOP 5.

## Deployments and documentation

What deploys where, and how the published docs are built, is application
knowledge: `apps/CLAUDE.md`, and the `deployment` and `docs-site` skills in
`apps/.claude/skills/`. The AI layer's view of it is `project.json`.

## Running it

**Editing dependencies needs npm 11.** npm 10 cannot resolve `vitest` 4's
optional peer set — its arborist crashes with *"Cannot read properties of
null (reading 'edgesOut')"* on `npm install`, `npm install --workspace` and
`npm ci` alike. The committed lockfile was regenerated with `npx npm@11`, is
still lockfileVersion 3, and `npm ci` reads it fine under npm 10 — which is
what CI runs. But if you change a dependency, do the lock step with
`npx npm@11 install`.

```bash
npm run verify                     # everything, about a minute
npm run verify:harness             # the AI layer's own tests, scripts/test
npm run verify:apps                # every app's own checks, from project.json
node scripts/verify-apps.mjs web   # one app's: typecheck, eslint, vitest, build, e2e
```

CI runs `verify` on every pull request and on pushes to `develop`, and the
branch ruleset requires it to pass before a merge. A red loop cannot land.

A `smoke` workflow runs after each merge to `develop`: for each deployed app
in `project.json`, it waits for the deployment to be this commit, then runs
that app's own checks (`scripts/smoke.mjs`). Claude Code Review comments
on every pull request; it is advisory, and `verify` is the only required check.

## Worktrees

Each agent works in its own worktree, so parallel work cannot collide — how to
create one, per-worktree e2e ports, and why previews do not pair themselves:
**read the `worktrees` skill**.
