# Extracting the baseline

How the step-2 apparatus in this repository is used on a project that is not a
family tree, and what would have to be pulled apart to get a base, a backend, a
frontend and an MCP template out of it.

This is a report on what is here today, measured rather than estimated. It does
not change any code.

---

## The finding

The reusable part was never mixed in.

Every file in `scripts/`, every hook in `.claude/hooks/`, and the status line
were counted for references to this project's domain — the words *family*,
*person*, *spouse*, *generation*, *cousin*, *sibling*. Across 1,985 lines of
scripts and 407 lines of hooks and status line, the total is **eight**, and
every one of them is a comment, a CSS `font-family`, or the word "person" used
about a human reader:

| File | Hits | What they are |
| --- | --- | --- |
| `scripts/write-api-url.mjs` | 3 | a comment naming the deployment hostname |
| `scripts/build-docs.mjs` | 3 | a footer link, a blurb, and `font-family` |
| `scripts/pr-contention.mjs` | 1 | "a person reading the comment" |
| `scripts/assert-review-ran.mjs` | 1 | "the text a person reading the log sees" |
| everything else | 0 | — |

So the honest answer to "how do I extract the reusable part" is that for most of
it there is nothing to extract. `scripts/test-census.mjs`, `review-scope.mjs`,
`pr-contention.mjs`, `paths.mjs`, `ports.mjs`, `markdown.mjs`, the four hooks and
the status line are already general-purpose programs that happen to live here.
They are copied, not carved.

What *is* entangled is smaller and sits in known places: the deployment
hostnames, the project name, and the domain model itself.

---

## What makes it the family tree

`CLAUDE.md` already states the domain in one rule: *a person is a name plus
relationships, stored minimally* — siblings, grandparents, cousins and children
are derived, never stored. That rule is also the extraction boundary, because it
forces the domain into one place.

The domain is **a stored shape plus the derivations over it**, and it is 287
lines:

| File | Lines | What it is |
| --- | --- | --- |
| `apps/api/src/api/models.py` | 30 | the stored shape — `Person`, and its JSON reader |
| `apps/api/src/api/tree.py` | 257 | every derivation, and the only place any of them lives |

Four transports carry that domain, and **none of them owns it**:

| Transport | File | Lines | How it reaches the domain |
| --- | --- | --- | --- |
| GraphQL | `apps/api/src/api/schema.py` | 127 | `_tree(info).cousins(...)` — resolvers only |
| REST | `apps/api/src/api/rest.py` | 127 | `create_router(tree)` |
| MCP | `apps/mcp/src/family_mcp/queries.py` | ~100 | `build_server(tree)` |
| Web | `apps/web/src/App.tsx`, `PersonCard.tsx` | 240 | over HTTP, through `api.ts` |

That is the architectural fact that makes templating possible at all. Swap
`models.py` and `tree.py` for a different stored shape and its derivations, and
the four transports need their field lists changed and nothing else. If the
derivations had been spread across the resolvers — one `siblings` in GraphQL,
another in the MCP server — there would be no seam to cut along, which is the
case `apps/mcp/pyproject.toml` argues for in its `[tool.uv.sources]` comment:
*"a second implementation of who counts as a cousin would be a second thing to
keep correct, with nothing to report when the two disagreed."*

Everything else in `apps/api/src/api/` — 778 lines across `main.py`,
`limits.py` and `security_headers.py` — knows nothing about people. It is
wiring, rate limiting and response headers.

---

## The four templates

### Base — the loop, and the rules that make it mean something

This is the valuable one, and it is the one that is already portable. It is the
step-1-to-2 machinery from `docs/adoption.md`: a self-verification loop you
trust, automated review, worktree isolation, auto mode.

**Take as-is, no edits:**

- `.claude/hooks/verify-on-stop.mjs` — the Stop hook that blocks a turn while
  `verify` is red. This is what converts "the contract" from a convention into a
  control. One constant to change: the `WATCHED` regex.
- `.claude/hooks/filter-verbose.mjs` — shrinks CI logs before they enter the
  conversation, at zero token cost. The command list is a narrow allow-list to
  extend, not domain logic.
- `.claude/hooks/format-edited.mjs` — autofix on edit. Worth reading for the
  `execFileSync`-with-argv treatment of untrusted filenames.
- `.claude/hooks/cloud-bootstrap.mjs` — gated on `CLAUDE_CODE_REMOTE`.
- `.claude/statusline.mjs` — context share and both usage windows, which is the
  only thing that makes SOP 4's "clear between tasks" actionable.
- `scripts/ports.mjs`, `scripts/paths.mjs` — worktree-derived e2e ports and one
  canonical path spelling. Both exist because of a specific defect; both are
  twenty lines.
- `scripts/test-census.mjs`, `scripts/review-scope.mjs`,
  `scripts/pr-contention.mjs`, `scripts/assert-review-ran.mjs` — the four checks
  that exist because a green tick meant nothing. All four are generic.
- `.claude/agents/` — `code-checker`, `security-checker`, `implementer`. The
  rubrics reference this project's files by name, so those lines change; the
  shape does not.
- `.claude/commands/gate.md`, `ship.md`.
- `.github/workflows/verify.yml`, `claude-code-review.yml`, `claude.yml`,
  `contention.yml`, `test-census.yml`, `telegram-notify.yml`.
- `telemetry/` — the OTel collector, Prometheus and Grafana stack, and
  `scripts/write-ci-telemetry-settings.mjs`, which exists because a settings
  `env` block outranks the process environment and silently redirected every CI
  export to a dead port.

**Take as a shape, rewrite the content:**

- `docs/sops.md` — the nine procedures transfer; the incident tables inside them
  do not. See *What must not be inherited*.
- `CLAUDE.md` — keep the structure (Layout, Rules, Deployments, Running it) and
  the under-200-lines target. Keep the rules that are about the loop rather than
  about people: `verify` is the contract, every behaviour change ships with a
  test, every change ships as a pull request, decide and act, one scale ranks
  everything, known gaps live in issues, context is the budget.
- root `package.json` — the `verify` / `verify:api` / `verify:web` / `verify:e2e`
  fan-out. Three lines, and the single most load-bearing file in the repository.
- `scripts/bootstrap.mjs`, `scripts/build-docs.mjs`, `scripts/markdown.mjs` and
  the `docs-site` skill — the published-docs half. Generic, but `MARKDOWN_PAGES`
  and the six-file checklist are per-project.

**Leave behind:** `.claude/trials/model-tiering.md` (measurements of this
repository), `.github/workflows/smoke.yml` (every assertion is a hostname or a
count), `index.html`, `design/`, `manual/`.

### Backend — FastAPI, Strawberry, uv, Vercel

**Keep, entirely domain-free:**

- `limits.py` (268 lines) — per-client rate limiting with an opt-in whitelist
  rather than an exemption list, and `API_RATE_LIMIT` defaulting to a real limit
  so an unset variable fails closed. Note the open defect it carries: the
  counter is per-process, and Vercel runs several.
- `security_headers.py` (197 lines) — the headers, and more usefully the written
  argument for each, including why `Strict-Transport-Security` is deliberately
  absent and what `'unsafe-inline'` costs the CSP.
- `main.py`'s wiring (313 lines) — `create_app(environment=, manual=)`, the
  middleware ordering argument (rate limiting inside CORS, security headers
  outermost), `expose_headers`, `render_manual`'s marker-based console gating,
  and the `/health` endpoint reporting `VERCEL_GIT_COMMIT_SHA`.
- `pyproject.toml`'s `[tool.vercel] entrypoint` and its comment.
- The `Repository` protocol and `FamilyTree.load(repository=...)`.

**Replace:** `models.py`, `tree.py`, and the field lists in `schema.py` and
`rest.py`. A reference domain of one entity with one derived view is enough to
keep the template's tests meaningful.

**Keep as pattern, not content:** `MAX_QUERY_DEPTH` and `DisableIntrospection`
in `schema.py`, `allow_queries_via_get=False`, and the `API_ENVIRONMENT` gate
over GraphiQL, introspection, Swagger, ReDoc and `openapi.json` — five consoles
turned off by one variable that defaults to the safe value.

### Frontend — Vite, React 19, Ionic, Playwright

**Keep, domain-free and hard-won:**

- `apps/web/src/api.ts` (175 lines) — `ApiError` with a typed `ApiFailure`,
  `parseRetryAfter` accepting both header forms, the 30-second timeout and the
  reasoning for it. None of this mentions a person.
- `App.tsx`'s `State` union and `AUTOMATIC_ATTEMPTS` retry posture — one
  automatic retry because the realistic first failure is a cold start the page
  load itself triggered, then a button. The rendering inside it is domain.
- `playwright.config.ts` — ports derived from the worktree, a real `uvicorn` and
  `vite preview` rather than the dev server, `API_ENVIRONMENT=development` in
  the webServer env.
- `e2e/api-servers.ts` and `e2e/cors-expose-headers.spec.ts` — the second is the
  only check in the repository that can tell a sent header from a readable one,
  and it caught three features that were inert in production.
- `vite.config.ts`, `eslint.config.js`, `tsconfig.json`, `prebuild`.

**Replace:** `PersonCard.tsx`, `filter.ts` (a generic list filter, but shaped
around generations), the generation grouping in `App.tsx`, `styles.css`.

### MCP — present, and the one correction to make

`apps/mcp` already exists: 303 lines of source, 511 of tests, wired into the
contract as `npm run verify:mcp`, and listed in `CLAUDE.md`'s Layout table. What
it is not is *deployed* — `CLAUDE.md` says so — which is probably what "isn't in
it presently" refers to. Either way there is a working reference implementation
to template from rather than a gap to fill.

**Keep:**

- `server.py`'s shape — `build_server(tree)` taking its subject rather than
  loading one, so a test can serve a fixture and `main()` can serve the real
  thing.
- `_actionable()` — the context manager that turns the two failures a client can
  act on into `ToolError`, so an unknown id reaches the client as a reason while
  a genuine bug still reads as a crash. This is the single most reusable idea in
  the directory.
- The closed vocabulary pattern: `RELATIONSHIP_TERMS` as a tuple, interpolated
  into both the server instructions and the tool description, because a
  docstring cannot interpolate and a description that drifts from what the tool
  can return teaches a client to expect terms nothing will send.
- `pyproject.toml`'s `[tool.uv.sources]` with `editable = true`, and its comment
  explaining that editable is load-bearing — the data path is found by walking
  up from the installed package.
- `asyncio_mode = "auto"`, the `conftest.py` fixture shape, and
  `[project.scripts]` giving the client a launch command.

**Replace:** `queries.py` and `relationships.py`.

---

## The seams already exist

The extraction is cheap because the code was already written to be injected
into, for testing. The same seams serve the template:

| Seam | Where | What it lets you swap |
| --- | --- | --- |
| `Repository` protocol, one method | `tree.py` | where the data comes from |
| `FamilyTree.load(repository=...)` | `tree.py` | the source, without touching the constructor |
| `create_app(environment=, manual=)` | `main.py` | both configurations in one process |
| `create_schema(disable_introspection=)` | `schema.py` | the production/development gate |
| `create_router(tree)` | `rest.py` | the subject |
| `build_server(tree)` | `mcp/server.py` | the subject |
| `install_rate_limiting(app)` | `limits.py` | already an app-shaped plugin |
| `install_security_headers(app, is_development=)` | `security_headers.py` | same |
| `ports(root)` | `scripts/ports.mjs` | the worktree |
| `canonical(path)` | `scripts/paths.mjs` | one spelling, everywhere |

The last two matter more than they look. `install_rate_limiting` and
`install_security_headers` take a FastAPI app and nothing else — they are
already libraries, sitting in a directory that happens to be an application.

---

## What has to be parameterised

Thirty-four tracked files carry a hardcoded `family-tree`, `stevemarvell` or
`boris`. Excluding the data, manual and design directories, they cluster into
four groups, and only the first is fiddly:

- **Deployment identity** — `apps/web/.env.production` (`VITE_API_URL`),
  `main.py`'s `ALLOWED_ORIGIN_REGEX` and FastAPI `title`, `smoke.yml`'s `API`
  and `WEB`, `scripts/write-api-url.mjs`, `scripts/build-docs.mjs`'s footer,
  and the branch-alias shape documented in the `deployment` skill.
- **Package names** — `package.json`, `apps/web/package.json`
  (`@family-tree/web`), both `pyproject.toml` files, `family_mcp` as a module
  name.
- **Telemetry names** — `boris-telemetry` as the compose project,
  `boris-prometheus` as the datasource uid, the Grafana provisioning name.
- **Test fixtures** — `hooks.test.ts`, `ports.test.ts`, `build-docs.test.ts`
  and five API test files reference names or counts.

A template that asks three questions at scaffold time — project slug, API
hostname, web hostname — covers the first three groups.

---

## What must not be inherited

This is the part worth reading twice. Four things in this repository are
*conclusions*, and copying a conclusion into a project whose premises differ is
how a template does damage.

**`docs/data-governance.md`'s verdict.** The API is unauthenticated, the whole
tree is one anonymous POST away, and CORS admits any `family-tree-*.vercel.app`
origin. That is defensible here for exactly one reason, which the document
states plainly: `data/family.json` contains nobody. It also names the trigger
that voids the decision — real data. **On a project with real data that trigger
has already fired on day one.** Take the document's *shape* — a posture, what
bounds it, and what would void it — and write a new verdict. Do not take the
verdict. The `security-checker` agent's rubric, which opens by telling the
reviewer the data is invented and public on purpose, has to be rewritten in the
same breath or it will wave through the exposure it was built to catch.

**SOP 3's table of five inert controls.** It is a record of what broke here,
and it is evidence for the rule, not the rule. Keep "a control is verified where
it runs"; empty the table and let the new project fill it. A table of someone
else's incidents is read once and never again.

**SOP 1's declared ceilings.** The numbers (3 attempts, 1 attempt, 2 rounds,
30 × 15s) are this repository's, and one of them exists because three subagents
died on session limits here. Keep the requirement that every loop declares a
maximum; set the maxima locally. Note that SOP 1 is honest about being
unenforced for the model-driven loops, and that `verify-on-stop.mjs` has no
counter — issue #80 is the obvious first improvement a new project inherits.

**The `smoke` assertions.** `"people":44` and "four generations" are the right
*kind* of check — a deployed-value assertion rather than a 200 — and exactly the
wrong content.

One more, smaller: `docs/adoption.md` is a rendering of a source document under
a rule that forbids rewording it. Copy it if useful, but it is reference
material, not project documentation, and the rule protecting it travels with it.

---

## How to do the extraction

**Fork and strip; do not copy files into a fresh repository.** In this codebase
the comments are most of the value. `main.py` does not just order its middleware
correctly, it explains that `add_middleware` inserts at the front so the last
one added is outermost, and what breaks if CORS is not outside the limiter.
`write-ci-telemetry-settings.mjs` is 161 lines of which perhaps 40 are code.
Hand-copying loses the half that took the failures to learn. A strip keeps it,
and keeps the git history that says when each line was added and why.

A workable order, each step landing as its own pull request:

- **Prove the seam first.** Before extracting anything, replace `models.py` and
  `tree.py` in a branch with a different two-entity domain and see what else
  goes red. That measures the coupling instead of trusting this report's
  reading of it, which is the same argument SOP 3 makes about controls.
- **Base template.** Fork, delete `apps/`, `data/`, `manual/`, `design/`,
  `index.html`, keep `.claude/`, `scripts/`, `.github/`, `telemetry/`, `docs/`.
  Rewrite `CLAUDE.md` and `docs/sops.md` to the shapes above, empty the incident
  tables, and gut `docs/data-governance.md` back to its three questions. Mark it
  a GitHub template repository.
- **Backend template.** Fork the base, add `apps/api` with `limits.py`,
  `security_headers.py` and `main.py` intact and a one-entity reference domain
  in place of `models.py`/`tree.py`.
- **Frontend template.** Fork the base, add `apps/web` with `api.ts`,
  `playwright.config.ts`, `e2e/api-servers.ts` and the CORS spec intact.
- **MCP template.** Fork the backend template — it has to, because the MCP
  depends on the backend package by editable path, and that dependency is the
  design rather than an accident.

Resist publishing any of this to npm or PyPI. Package registries, versioning and
a release process are step-3 costs, and `CLAUDE.md`'s own rule is not to reach
for tooling that belongs to a later stage. Four template repositories that are
forked and edited are the step-2 answer.

---

## What the baseline does not give you

Stated plainly, because a template that oversells is worse than none.

- **No step-3 fan-out.** `/loop`, `/batch`, `/goal`, routines and dynamic
  workflows are deliberately untouched here. `docs/adoption.md` lists them under
  step 3, and issue #121 records the decision to leave them alone.
- **One required check.** `verify` is the only one. `contention`, `test census`
  and both reviews are advisory, and the reason is written down: a gate that
  goes red for its own reasons is one people learn to click past. A new project
  inherits that judgement and may want a different one.
- **Two known open defects travel with the code.** The rate limiter's counter is
  per-process while the platform runs several (#128), and `verify-on-stop.mjs`
  has no iteration counter (#80). Both are worth fixing in the template rather
  than in each project that forks it.
- **The e2e suite is the expensive part.** `verify:e2e` needs both toolchains
  and a Playwright browser per worktree. `scripts/bootstrap.mjs` handles it, but
  it is minutes, not seconds, and it is what makes parallel worktrees costly.
- **Nothing here is multi-developer.** One author, one queue — which is the
  explicit premise of SOP 5's single ranking scale, and the reason `#103` is
  ranked where it is. A second person with write access changes several of these
  answers, and SOP 5 names that as the trigger.
