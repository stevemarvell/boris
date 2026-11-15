# Data governance

Whatever this project deploys can be read by anyone who knows the URL. That
is a decision rather than an oversight, and this page is the decision: what
is exposed, why it is acceptable today, and the one fact that would change
the answer.

> Nothing is deployed by default. `project.json` declares no app's `deploy`
> block, so there is no URL for anyone to read — `npm run deploy:add` is what
> adds one. The moment an app is actually deployed, this page has to be
> rewritten for what it exposes.

This is the *data governance* guardrail from step 0 of `docs/adoption.md`. It
is written down so that it can be found and argued with, instead of being
inherited as whatever nobody got around to changing.

One section here is not about the deployed apps at all — "What CI holds, and
what voids that" applies the same three questions to the credentials the
review jobs carry, because that posture has the same shape and the same need
for a written trigger.

---

## What is public

Nothing. `node scripts/project.mjs --has-deploy` says so, and anyone can run
it: no app in `project.json` has a `deploy` block, so there is no URL `curl`
could even be pointed at.

This is not a decision in the same sense the rest of this page is: it is
just the current, default state of a repository nothing has been deployed
from yet. Once `npm run deploy:add` adds a real deployment, the table that
used to live here — what's public, by request and response, measured with
`curl` sending no credentials — has to come back, written against what that
app actually serves.

Vercel's preview deployments are open by design wherever anything is
deployed through it: an agent reviewing a pull request has to be able to
load one. That stays true the day deployment comes back, and is recorded
here so it isn't re-discovered as a surprise.

## Why that is acceptable

Nothing is exposed because nothing is deployed. There is nothing to protect,
so there is nothing to authenticate. The moment that stops being true —
`npm run deploy:add` run for real, against a real Vercel project — this
section has to be rewritten for what the newly deployed app actually holds
and serves, not left to describe a state that no longer exists.

## What is deliberately absent

Any deployment at all, by default. A project built from this one adds one
deliberately, app by app, with `npm run deploy:add` — never by inheriting
whatever the base repository happened to have running.

## The trigger to revisit

`npm run deploy:add` run for real — any app, even one of the placeholder
shells `apps/` ships with today. The moment anything is actually deployed,
this page has to be rewritten for what that app exposes, and the decision
above stops holding by default.

## What CI holds, and what voids that

The page above is about what the *deployments* expose. This section is about
what the *pull request checks* hold, because it has the same shape and needs
the same kind of written trigger.

Three jobs run branch code with something live in the step. Two are in
`.github/workflows/claude-code-review.yml` and carry a credential: the code
review and the security review. The third is the `pr checks` job in
`.github/workflows/pr-checks.yml`, which carries a write-scoped token instead
and is described after them. Each one checks out the pull request and runs a
script from that checkout before its main work starts.

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

Issue text from strangers is data, not instructions. This repository is
public, so anyone can open an issue, and the unattended `work-backlog` loop
reads issues. `scripts/triage.mjs` holds out of the loop any issue whose
author is not the repository owner and that carries no rank label (only an
account with triage access can add one), so a stranger's text is never
implemented, merged or deployed without the owner seeing it.

### What bounds it

Two things, and only one of them is written in the configuration:

- **The trigger is `pull_request`, not `pull_request_target`.** A fork gets no
  secrets. This *is* in the configuration, and it is what stops a stranger.
- **One person has write access.** The only account that can open a pull
  request on this repository is the account that owns the credential, so
  "arbitrary code with the Grafana credential" is that person running their
  own code with their own credential. Nothing in the code says this. It is a
  fact about the repository's membership, and it carries the whole of the
  remaining severity. `dependabot[bot]` now opens pull requests too (#227); for
  the `pull_request` runs it initiates, GitHub documents that `GITHUB_TOKEN` is
  read-only by default and that secrets come from Dependabot's own secrets, not
  the repository's Actions secrets ("Dependabot on GitHub Actions",
  docs.github.com/en/code-security/reference/supply-chain-security/dependabot-on-actions).
  That is GitHub's documented behaviour, taken from its documentation source;
  it has not been verified here. One consequence follows:
  `CLAUDE_CODE_OAUTH_TOKEN` is a repository secret, so it is not there either,
  and the code and security reviews do not run on a `dependabot[bot]` pull
  request (unless that secret is added, below; the driver also does not add
  `re-review` to one, because whether a human-added label would get the
  repository's secrets there has not been tested, and runs the checkers by hand). Each review job checks whether the token is available and, when it
  is empty and the author is `dependabot[bot]`, skips the review and ends green
  with a notice naming #244 (`.github/workflows/claude-code-review.yml`); those
  pull requests are reviewed by hand. An empty token on any other pull request
  is not skipped: the review fails red with a warning, because a lost secret
  must not look like a pass. Adding the token as a Dependabot secret would
  start the Dependabot reviews with no workflow change, and would put the token
  in runs whose diff is third-party package content; that is the owner's call.

The scope job is not in this list: it checks out the base commit, so the
rule deciding which reviews run is not the branch's copy. The
two credentialed jobs still check out the merge ref, because a reviewer that
cannot read the change under review is not a reviewer.

### What the sandbox adds here, and what it does not

Both credentialed jobs run their Bash tool — `gh pr diff` and
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
write access" — the sandbox is a second layer around what the reviewing
session itself can do with its two allowed commands, not a boundary around
the step that hands it the credential.

### A third job of the same shape, holding a different thing

`pr checks` in `.github/workflows/pr-checks.yml` carries no Grafana
credential, and it is in this list anyway, because the structure is identical:
it checks out the pull request's merge ref and runs `scripts/pr-contention.mjs`
and `scripts/test-census.mjs` from *that* checkout, with `GITHUB_TOKEN` scoped
`pull-requests: write` live in the job. (The census used to run in its own
workflow with a read-only token; folding it in widened it to this scope.)

What that scope permits is wider than what the job does with it. GitHub has no
comment-only permission, so the scope that lets it post and edit its own
comment also permits **merging, closing, retitling and labelling any open pull
request**. A pull request that edits `scripts/pr-contention.mjs` or
`scripts/test-census.mjs` runs its own code with that scope, the same way one editing
`scripts/write-ci-telemetry-settings.mjs` runs its own code with the Grafana
credential.

The same two things bound it — `pull_request` rather than `pull_request_target`,
and one account with write access — and the same trigger voids it. So on that
day this job needs the same treatment as the other two: run
`scripts/pr-contention.mjs` and `scripts/test-census.mjs` from the default
branch rather than the branch under review. It is listed here because
the remediation plan below has to be a complete list on the day it is used, and
a job missing from the inventory is a job nobody remembers to fix.

### Reviews run once, and are advisory

The code and security reviews run when a pull request is opened, reopened or
marked ready, and again only when the `re-review` label is added. They do not
re-run on a push, so a pull request opened harmlessly and extended later gets no
automated review of the later commits. A workflow cannot close that: a label
added with `GITHUB_TOKEN` starts no workflow run. What closes it is the driver
rule in `drive-pr` step 4 (which `work-backlog` applies before every merge): it
defines when to add `re-review` with the coordinator's own token and wait for
it, and what to do instead for a workflow edit or a Dependabot pull request.
The reviews are advisory, not required.
The bound therefore holds while one person with write access drives merges and
follows that rule; **a second writer, or unattended merging without the rule,
voids it.**

### A fourth credential, held the other way round

`.github/workflows/preview-prune.yml` holds `VERCEL_TOKEN`, scoped to whatever
Vercel team a deployed app's `deploy.team` names, and deletes preview
deployments: a branch's own when its pull request closes, and — run by hand —
every preview whose branch no longer exists. It also trims production history
(`history`): Vercel keeps a production deployment per merge, forever, and this
keeps only the one serving each app — found from the app's alias, never
inferred — and the newest few built ones; a built deployment newer than the
live one, or one still building, is left, and cancelled or failed records,
which never served, go. A Vercel token cannot be narrowed below the team, so
the token could do anything the team can, including delete production. While
`node scripts/project.mjs --has-deploy` says nothing is deployed, the job
checks that first and does none of this.

It is not in the class above, because no branch code runs beside it. The
trigger is `pull_request_target`, so the workflow file is `develop`'s; the
checkout is `develop`, explicitly; and the pull request's branch name is the
only thing read from it, passed through `env:` as data. Fork pull requests are
skipped outright. So a second person with write access does not change this
job — their branch cannot rewrite it or run in it. What bounds it instead is
`scripts/deploy/vercel/vercel-prune.mjs` itself, reviewed on its way into
`develop`: the
preview modes refuse production deployments and anything built from `develop`
per deployment, whatever the query returned, and refuse an empty live-branch
list rather than read it as "every preview is stale"; the `history` mode never
deletes the deployment an app's alias points at, and deletes nothing if it
cannot find it.

Old production deployments are recoverable the same way: each is a build of
a commit on `develop`, which is never rewritten, so any of them can be rebuilt.
What the close-time run deletes is recoverable: a preview is a build of a
commit, and GitHub keeps every pull request's head at `refs/pull/<n>/head`, so
that preview can be rebuilt. That is why it runs unattended. The backlog run
is not covered by the same argument — it deletes the preview of any branch
that no longer exists, including one pushed and deleted without a pull request
ever being opened, whose commit nothing keeps. So that run is started by a
person and defaults to a dry run that lists what it would delete.

Whichever `VERCEL_TOKEN` is current — `npm run deploy:add`'s owner steps are
what add one, and record its expiry in this file and README.md's secrets
table — bounds this by that recorded date. On that day the job fails loudly
and nothing else is affected: deploys go through Vercel's Git integration,
not this token.

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

The same day reaches one thing that is not a CI job. The `work-backlog`
skill picks issues and merges to `develop` unattended, and it reads issue and
comment text. It treats that text as data that can only narrow what it does.
A "go" clearing a wait counts only from the repository owner's account, by
author login. Today that distinction changes nothing, because the one writer
is the owner. Once a second person can open or edit issues, it is the only
thing keeping their text from steering a loop that deploys. Confirm it still
holds before access is granted.

## What going private did, and did not do

The repository is private. That makes the source, the issue tracker and the
Actions logs unreadable to strangers, and it retires one real risk: a
`@claude` workflow that any stranger's comment could trigger. The
`author_association` guard in `.github/workflows/claude.yml` is what actually
carries that.

It removes no published URL. Every row in the table above was checked from
outside the repository. Being private changes who can read the source; it
changes nothing about who can read the data.

Two side effects are worth knowing, because both look like breakage:

- GitHub Actions minutes are billed rather than free.
- GitHub Pages needs a paid plan on a private repository, which is why
  `stevemarvell.github.io/boris/` returns `404` and why everything it would
  publish is served from Vercel instead.

Visibility was never the control. If it had been, the table above would be
shorter.
