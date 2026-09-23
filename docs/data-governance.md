# Data governance

Everything this project deploys can be read by anyone who knows the URL. That
is a decision rather than an oversight, and this page is the decision: what is
exposed, why it is acceptable today, what keeps it defensible, and the one fact
that would change the answer.

> The deployed data is invented, and it is public on purpose. The API stays
> unauthenticated. The controls that make that defensible — rate limiting, and
> gating the executable query console out of production — are being added.
> Authentication is the thing that changes if real family data ever lands here,
> and that is the trigger to revisit.

This is the *data governance* guardrail from step 0 of `docs/adoption.md`. It
is written down so that it can be found and argued with, instead of being
inherited as whatever nobody got around to changing.

One section here is not about the deployed data at all — "What CI holds, and
what voids that" applies the same three questions to the credentials the
review jobs carry, because that posture had the same structure and no written
trigger.

---

## What is public

Checked on 2026-09-16, after #126 cut the API over from Railway to Vercel,
with `curl`, sending no credentials, from outside every deployment:

| Request | Anonymous response |
| --- | --- |
| `GET family-tree-api-stevemarvell-team.vercel.app/health` | `200` — `{"ok":true,"people":44,"commit":null}` |
| `GET family-tree-api-stevemarvell-team.vercel.app/` | `200` — the API manual, **Run query** console *not* present |
| `POST family-tree-api-stevemarvell-team.vercel.app/graphql` | `200` — `{ people { name } }` returns all 44 names |
| `GET family-tree-api-stevemarvell-team.vercel.app/graphql` | `404` — there is no IDE to open |
| `POST .../graphql` asking for `__schema` | `200` with errors — *"GraphQL introspection has been disabled"* |
| `GET family-tree-web-eta.vercel.app/` | `200` — the web app |
| `GET family-tree-web-eta.vercel.app/docs/` | `200` — the documentation, this page among it |
| `GET stevemarvell.github.io/boris/` | `404` — Pages is gone, see below |
| `GET api-production-53f7b.up.railway.app/health` | `404` — Railway is gone too, see the `deployment` skill |

Vercel's preview deployments are open as well, and deliberately so: an agent
reviewing a pull request has to be able to load one.

So: the whole tree, on demand, to anyone, in one unauthenticated POST.

## Why that is acceptable

`data/family.json` is invented. Forty-four people across four generations, each
one an id, a name, a list of parent ids and a spouse id — no dates, no places,
no addresses, no photographs, no contact details, and no correspondence to
anybody who exists. It is a test fixture that the application happens to serve.

What is public, then, is a plausible graph of names nobody has. Publishing it
costs nothing and buys the thing this project is for: a deployment that a
stranger, or an agent, can open and exercise without being issued a credential
first. The API manual's console is only useful because there is nothing behind
the door worth locking.

## What makes it defensible rather than merely unnoticed

Open is not the same as unguarded. What an anonymous caller can do is bounded
— by two controls already in place, and two being added:

- **A query depth limit.** `MAX_QUERY_DEPTH = 6` in
  `apps/api/src/api/schema.py`. A person's relationship fields are mutually
  recursive, so each extra level of nesting costs roughly 3.5x: a security
  review measured depth 8 at 3.1 CPU-seconds and depth 10 at 23.7s, against
  0.14s for the worst case depth 6 still admits. The deepest query the app or
  the manual ever sends is depth 3.
- **No introspection, and no IDE.** `API_ENVIRONMENT` in
  `apps/api/src/api/main.py` defaults to `production`, which disables schema
  introspection and serves no GraphiQL. It is never set on the Vercel project,
  so the deployed behaviour is the default and a forgotten variable fails
  closed. Both are confirmed by the table above.
- **Rate limiting, at Vercel's edge and in process.** 120 requests per minute
  per client IP, on `/graphql`, `/person` and `/me`. The ceiling that holds is
  the Vercel WAF rule committed as `apps/api/firewall.json`, counted at the
  edge before any function instance runs; `apps/api/src/api/limits.py` repeats
  the limit in process, per instance. The depth limit caps what one query
  costs and says nothing about a thousand cheap ones.
  `/health` and the manual are deliberately *not* limited — `/health` is the
  path Playwright polls for readiness, and a 429 there is the wrong signal to
  give anything that acts on it.

  The *key* half of this — one caller, one bucket, not fooled by a spoofed
  header — was re-measured against the live Vercel deployment after #126 and
  holds: five requests, two carrying forged `X-Real-IP`/`X-Forwarded-For`
  values, drained one shared counter monotonically. That repeats the
  discipline that first caught this class of bug: an earlier version of
  `client_key` keyed on the rightmost `X-Forwarded-For` hop, reasoning it was
  the one a caller could not forge, and Railway's edge turned out to be a pool
  of five nodes — 571 requests answered in twelve seconds against a 120/minute
  limit, one caller split across five counters, unit tests green throughout
  because `TestClient` is one process with one stable key and the deployment
  is neither.

  The in-process *ceiling* does not hold on Vercel, and #126's migration is
  what surfaced it: 200 concurrent requests against the live deployment were
  answered by several execution environments in parallel, each with its own
  in-memory counter — `X-RateLimit-Remaining` repeated the same values instead
  of draining once. That made five times that a control here was present,
  running, and doing less than its own tests and docstring claimed. The fix
  (#128) is the edge rule above: Vercel's WAF rate limiting is available on
  Hobby at no cost (one rule per project, IP-keyed, fixed window), so no new
  service or storage was needed. Two limits remain on the WAF itself. Its
  counters are per *region*, so one caller spread across regions could exceed
  the limit, though a single address reaches one region. And the rule is
  applied with `vercel firewall`, not by a deploy, so the file and the live
  config can drift: `tests/test_firewall.py` holds the file to `limits.py`,
  and the `smoke` workflow's last step fires a 300-request burst and fails
  unless the edge refuses some of it.
- **A gate on the query console.** The API serves its own manual at its root,
  and that manual carries a **Run query** button posting to `/graphql` on the
  same origin: a working console, no setup, no CORS negotiation. It is gated
  on `API_ENVIRONMENT`, the same mechanism as the IDE, so production
  serves the documentation without the console — confirmed on the deployment,
  which returns the manual with no `id="run"` and no endpoint string. The
  worked examples remain, with a `curl` that names whichever deployment is
  serving it.

  The gate reaches pull request environments too, since `API_ENVIRONMENT` is
  unset there as well. Setting `API_ENVIRONMENT=development` on one restores
  its console, and opens GraphiQL and introspection there in the same move.

One smaller decision belongs in the same list: `allow_queries_via_get=False`,
also in `api/main.py`. A GraphQL query is a short string that can trigger an
expensive resolution, so accepting one over GET would turn an `<img src>` on
any page on the internet into work this server has to do. It is off in both
environments.

## What is deliberately absent

Authentication. Every query is anonymous, and `/health` reports the size of the
tree to anyone who asks.

Adding it later is not one middleware line, because the CORS policy in
`apps/api/src/api/main.py` is written on the assumption that no credentials
ever travel:

```python
allow_methods=["GET", "POST", "OPTIONS"],
allow_headers=["content-type"],
```

There is no `allow_credentials`, and `content-type` is the only admitted
request header — an `Authorization` header would be refused at the preflight,
by a browser, before the API ever saw it. So authentication means revisiting
CORS in the same change. Anyone who splits the two will spend an afternoon
debugging a preflight.

## The trigger to revisit

Real data. One actual relative, one actual birth date, anything in
`data/family.json` that is not invented — and this decision is void rather than
in need of review. The trigger is the data changing, not the traffic changing:
nothing here should wait to be noticed first.

What that change has to cover, collected in one place so nobody has to
rediscover it:

- authentication on `/graphql`, and with it the CORS policy above;
- `/health` no longer reporting the tree size to anonymous callers;
- the manual's console gated out of production, or moved behind the same
  authentication;
- the Vercel deployment and its previews, which are open by the same
  reasoning and stop being defensible by it at the same moment.

## What CI holds, and what voids that

The page above is about what the *deployments* expose. This section is about
what the *pull request checks* hold, because it has the same shape and until
now had no written trigger.

Three jobs run branch code with something live in the step. Two are in
`.github/workflows/claude-code-review.yml` and carry a credential — the code
review and the security review; the third is `contention`, which carries a
write-scoped token instead and is described after them. Each one checks out the pull request and
then runs a script from that checkout before the review starts.

```yaml
- name: Checkout repository
  uses: actions/checkout@...
- name: Point this session's telemetry at Grafana Cloud
  run: node scripts/write-ci-telemetry-settings.mjs
```

The job-level `env:` puts `GRAFANA_CLOUD_OTLP_ENDPOINT` and
`GRAFANA_CLOUD_OTLP_AUTH` in that step's environment. So a pull request that
edits `scripts/write-ci-telemetry-settings.mjs` runs its own code with the
Grafana credential readable. The same reasoning covers `.claude/hooks/*.mjs`,
which the session `claude-code-action` starts will load from the branch.

`CLAUDE_CODE_OAUTH_TOKEN` is **not** reachable this way. It is a step input to
the action rather than a job-level variable, so it lives only in the action's
own step environment, which no branch code runs in.

### What bounds it

Two things, and only one of them is written in the configuration:

- **The trigger is `pull_request`, not `pull_request_target`.** A fork gets no
  secrets. This *is* in the configuration, and it is what stops a stranger.
- **One person has write access.** The only account that can open a pull
  request on this repository is the account that owns the credential, so
  "arbitrary code with the Grafana credential" is that person running their
  own code with their own credential. Nothing in the code says this. It is a
  fact about the repository's membership, and it carries the whole of the
  remaining severity.

The scope job is not in this list: it checks out the base commit (#99), so the
rule deciding which reviews run is not the branch's copy. The
two credentialed jobs still check out the merge ref, because a reviewer that
cannot read the change under review is not a reviewer.

### What the sandbox added for #150 changes here, and what it does not

Both credentialed jobs now run their Bash tool — `gh pr diff` and
`gh pr view`, the only two commands their `--allowedTools` permits —
inside Claude Code's own sandbox; `docs/sops.md` SOP 10 has the
configuration. It bounds what those two commands can reach once the
*session* asks to run them: `bubblewrap` enforces the filesystem and
network rules at the OS level, on the process, rather than a permission
rule deciding whether to allow the call.

It does not touch the bound above. The step that runs
`scripts/write-ci-telemetry-settings.mjs` — the one with the Grafana
credential live in its environment, from branch code — is a GitHub
Actions `run:` step: plain Node, executed before `claude-code-action`
starts a session at all. The sandbox wraps commands the session runs once
it is running; it has no reach into the workflow step that precedes it.
So the exposure this section describes is still bound by "one person has
write access," exactly as before — the sandbox is a second layer around
what the reviewing session itself can do with its two allowed commands,
not a boundary around the step that hands it the credential.

### A third job of the same shape, holding a different thing

`contention` in `.github/workflows/contention.yml` carries no Grafana
credential, and it is in this list anyway, because the structure is identical:
it checks out the pull request's merge ref and runs `scripts/pr-contention.mjs`
from *that* checkout, with `GITHUB_TOKEN` scoped `pull-requests: write` live in
the step.

What that scope permits is wider than what the job does with it. GitHub has no
comment-only permission, so the scope that lets it post and edit its own
comment also permits **merging, closing, retitling and labelling any open pull
request**. A pull request that edits `scripts/pr-contention.mjs` runs its own
code with that scope, the same way one editing
`scripts/write-ci-telemetry-settings.mjs` runs its own code with the Grafana
credential.

The same two things bound it — `pull_request` rather than `pull_request_target`,
and one account with write access — and the same trigger voids it. So on that
day this job needs the same treatment as the other two: run the script from the
default branch rather than the branch under review. It is listed here because
the remediation plan below has to be a complete list on the day it is used, and
a job missing from the inventory is a job nobody remembers to fix.

### A fourth credential, held the other way round

`.github/workflows/preview-prune.yml` holds `VERCEL_TOKEN`, scoped to the
`stevemarvell-team` Vercel team, and deletes preview deployments: a branch's
own when its pull request closes, and — run by hand — every preview whose
branch no longer exists. A Vercel token cannot be narrowed below the team, so
the token could do anything the team can, including delete production.

It is not in the class above, because no branch code runs beside it. The
trigger is `pull_request_target`, so the workflow file is `develop`'s; the
checkout is `develop`, explicitly; and the pull request's branch name is the
only thing read from it, passed through `env:` as data. Fork pull requests are
skipped outright. So a second person with write access does not change this
job — their branch cannot rewrite it or run in it. What bounds it instead is
`scripts/vercel-prune.mjs` itself, reviewed on its way into `develop`: it
refuses production deployments and anything built from `develop` per
deployment, whatever the query returned, and refuses an empty live-branch list
rather than read it as "every preview is stale".

What it deletes is recoverable. A preview is a build of a commit, and GitHub
keeps every pull request's head at `refs/pull/<n>/head`, so any deleted
preview can be rebuilt.

The token expires a year after 2026-09-23. On that day the job fails loudly
and nothing else is affected: deploys go through Vercel's Git integration, not
this token.

### The trigger

**A second person gets write access to this repository.** Not a fork, not an
outside contributor opening a pull request — those are already handled. Write
access, which is what makes `pull_request` run with secrets.

On that day, before the access is granted, one of these has to land:

- move the pre-review script step to run from the default branch, the way the
  scope job already does, so branch code never executes in a credentialed
  step; or
- drop the job-level `env:` entirely and pass the Grafana values as inputs to
  the action's own step, so no secret is live before the action starts.

The second is the smaller change and the stronger one. Either way the point is
the same as the trigger at the top of this page: the decision is defensible
today for a reason that is not written in the configuration, so the reason is
written here instead.

## What going private did, and did not do

The repository went private on 2026-09-13. That made the source, the issue
tracker and the Actions logs unreadable to strangers, and it retired one real
risk: a `@claude` workflow that any stranger's comment could trigger. The
`author_association` guard in `.github/workflows/claude.yml` was what actually
carried that, and it stays.

It removed no published URL. Every row in the table above was checked *after*
the switch. Making the repository private changed who can read the source; it
changed nothing about who can read the data.

Two side effects are worth knowing, because both look like breakage:

- GitHub Actions minutes are billed now rather than free.
- GitHub Pages needs a paid plan on a private repository, which is why
  `stevemarvell.github.io/boris/` returns `404` and why everything it would
  publish is served from Vercel, or from inside the API image, instead.

Visibility was never the control. If it had been, the table above would be
shorter.
