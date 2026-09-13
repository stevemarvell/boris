# Backlog

Gaps against `adoption.md`, tagged by the step they belong to.

| Tag | Step |
| --- | --- |
| `aia0` | 0 — Gated: permission, infrastructure, governance |
| `aia1` | 1 — Assisted: the verification loop, and seeing what it costs |
| `aia2` | 2 — Parallel: orchestration and review at scale |

---

## aia0

- [ ] **The repository is public.** This was a default, not a decision — it was
      public from the first push and nobody chose it. Fine for a practice
      project with invented family data; not fine if anything real lands here.
      It is the doc's *data governance* guardrail, and the one step-0 axis with
      no control at all. Vercel preview URLs are currently public by deliberate
      choice so agents can read them.

      The security review of 2026-09-12 leaned on this one twice: the `@claude`
      workflow can be triggered by any stranger's comment, and the API is open
      to the world. Both are only acceptable while the data is invented.

      The GitHub Pages obstacle is gone. Pages on a private repository needs a
      paid plan, so everything it published — the step-0 page, both manuals,
      the Markdown in this directory — moved onto the deployments this project
      already pays nothing for: `/docs/` on Vercel, and the API manual at the
      root of the Railway service. Flipping the repository to private now costs
      no published page. It also deleted a CORS allowance:
      `stevemarvell.github.io` existed only so the Pages-hosted API manual
      could call the API, and the manual is same-origin now.

- [ ] **No rate limiting anywhere.** The depth limit from #34 caps what a
      *single* query can cost. It does nothing about a thousand cheap ones.
      Railway has no WAF and the service runs a single instance with
      `sleepApplication: true`, so the floor is low. The two honest options are
      middleware in the app (`slowapi`) or Cloudflare in front of the Railway
      host, and the second one moves configuration into a dashboard, which this
      project has a rule against. Worth deciding deliberately rather than
      discovering.

- [ ] **The API has no authentication at all.** Every GraphQL query is
      anonymous, and `/health` tells you how many people are in the tree. That
      is the right call for invented data published on purpose, and the wrong
      one the moment a real family lands here. It is the same decision as the
      repository being public, and it should be made at the same time — note
      that the CORS policy is currently written assuming no credentials ever
      travel, so authentication would need that revisited in the same change.

- [ ] **The public manual runs queries against production.**
      `manual/api/index.html` ships a console pointed at the live API, which is
      a genuinely good piece of documentation and also an invitation. It is the
      reason the depth limit matters rather than being theoretical. If the API
      ever stops being public, this page has to move to the preview API or lose
      the Run button.

- [x] **`origin/HEAD` is not set on the remote.** ~~There is no `main` branch —
      only `develop` — and nothing tells a clone which branch is the default.
      Any tool that resolves `origin/HEAD` to find the base of a change fails
      outright; `/security-review` did exactly that on 2026-09-12, which is why
      it reviewed the whole codebase instead of a diff. One command fixes it:
      `git remote set-head origin -a`. Left unrecorded it will bite the next
      tool that assumes a default branch exists.~~ Run on 2026-09-13; this
      checkout now resolves `refs/remotes/origin/HEAD` to `origin/develop`, and
      a tool looking for the base of a change finds one.

      The title was always slightly wrong, and the difference is how far the fix
      reaches. `origin/HEAD` is a property of each clone, not of the remote —
      the command wrote a local ref and pushed nothing. A fresh clone of this
      repository gets its default from GitHub's default-branch setting, which is
      `develop` and therefore right; but that is a different mechanism answering
      the same question. Fixed for this working copy; anywhere else it rests on
      that setting staying correct.

## aia1

- [x] **No telemetry.** ~~Nothing measures token use, active time, or output per
      merged change.~~ Shipped in #29, merged 2026-09-13. A subagent already died mid-task on a session limit, which
      is the cheap version of this problem.

      Cost in dollars is a function of the plan, so the signals worth having are
      `claude_code.token.usage` against `claude_code.pull_request.count` — tokens
      per merged change — and `claude_code.active_time.total`.

      First step costs nothing and needs no collector; it just prints metrics to
      the terminal, which is enough to decide whether standing anything up is
      worth it:

      ```bash
      CLAUDE_CODE_ENABLE_TELEMETRY=1 OTEL_METRICS_EXPORTER=console         OTEL_METRIC_EXPORT_INTERVAL=10000 claude
      ```

      Anything durable needs a collector plus Prometheus/Grafana, or a hosted
      backend. Prompts, responses and tool inputs are redacted by default; leave
      them that way. <https://code.claude.com/docs/en/monitoring-usage>

      #29 skipped the console step and shipped the durable version — OTLP
      collector, Prometheus, Grafana, `telemetry/`, `telemetry/check.sh`.
      ~~Metrics only, so the redaction above is preserved by never opening the
      events pipe.~~ Verified against the running stack, which is how it was
      caught that the first version of the scrub silently did not scrub.

      That last sentence was true of #29 and is no longer the rule. #39 opened
      the events pipe on purpose — `OTEL_LOGS_EXPORTER=otlp` in
      `.claude/settings.json` and in both workflows — because Grafana Cloud's
      Claude Code integration reads events as well as metrics and its dashboards
      are half empty without them. Keeping the pipe shut was stricter than the
      rule asked and cost those dashboards.

      The redaction now lives where it always meant to: `OTEL_LOG_USER_PROMPTS`,
      `OTEL_LOG_TOOL_DETAILS` and `OTEL_LOG_TOOL_CONTENT`, which turn events from
      *which tool ran, how long, which model* into the prompts and file contents
      themselves. None of the three is set anywhere in this repository, and they
      are deliberately absent rather than `"0"` — `"0"` is a truthy string in too
      many places, and absence cannot be misread.

- [ ] **The dashboard has real data now, and nobody has opened it.**
      ~~`telemetry/check.sh` pushes a made-up payload and proves the pipeline
      carries it, which is what caught the scrub bug — but no panel has yet
      rendered a real Claude Code session. The exporter settings are read at
      session start, so the first genuine data arrives only after a restart.~~
      A real session reached the local Prometheus on 2026-09-13:
      `claude_code_token_usage`, `claude_code_cost_usage`,
      `claude_code_active_time_total` and `claude_code_session_count` all carry
      one, split by model and token type the way the panels expect. The scrub
      held on live data as well as synthetic — no `user_email`, `user_id` or
      `organization_id` label exists on any series.

      One metric has no series at all: `claude_code_pull_request_count`, which
      Claude Code emits only once a session actually opens a pull request. Worth
      recording precisely, because it is exactly the "No data" that means
      nothing is wrong — and it is the expensive one to misread, since tokens
      per merged pull request, the number this whole directory exists to
      produce, is the one panel that cannot render until that metric arrives.

      What is left is the part no query substitutes for: open the dashboard and
      walk it panel by panel. "No data" over a metric that *does* have series is
      a wrong name or a wrong query and needs fixing; "No data" over
      `pull_request_count` is the pipeline waiting, and needs nothing.

- [ ] **The API image has no automated regression test.** #31 dropped the
      container to an unprivileged user and that was verified by building and
      running the image by hand — `id` reporting uid 999, `data/` unwritable,
      `/health` serving 44 people. Nothing stops the next Dockerfile edit
      putting root back. A CI job building the image on pull requests is the
      natural guard; it was left out of #31 because adding a job changes shared
      CI, and `verify` is the only required check.

- [ ] **CI telemetry is wired and credentialed, and has never exported
      anything.** #37 wires `claude-code-review` and the `@claude` workflow to
      ship metrics, which is the spend least likely to be noticed — nobody
      watches either run. ~~It needs a Grafana Cloud stack and two repository
      secrets, `GRAFANA_CLOUD_OTLP_ENDPOINT` and `GRAFANA_CLOUD_OTLP_AUTH`, and
      until they exist `CLAUDE_CODE_ENABLE_TELEMETRY` is deliberately `0` rather
      than pointing at a `localhost` nothing listens on.~~ Both secrets were set
      on 2026-09-13 — the endpoint at 13:04Z, the auth header at 13:07Z — so the
      gate that holds `CLAUDE_CODE_ENABLE_TELEMETRY` at `0` now opens.

      Nothing has run through it. The most recent `Claude Code Review` run was
      08:34Z on #39, hours before either secret existed, so not one metric has
      ever left a runner. What is proven is the *inert* path — #37's own review
      job ran green with the secrets absent — and that is the opposite of what
      needs proving now. The next pull request to open is the test, because its
      review job is the first that will run with a credential; the one carrying
      this edit is that pull request.

      The first credentialed runs produced nothing at all. #40, #41 and #42 all
      ran `Claude Code Review` with `CLAUDE_CODE_ENABLE_TELEMETRY: 1`, an
      endpoint, a header and `environment=ci` in `OTEL_RESOURCE_ATTRIBUTES` —
      and Grafana Cloud showed no Linux host at all, only Windows. A failed OTLP
      export writes nothing to the Actions log, so a runner looks identical
      whether the credential works or not, which is the same silent class of
      failure as the temporality gap #39 fixed. Re-setting both secrets from the
      credential already proven to work changed nothing, because the credential
      was never the problem.

      The cause was the same precedence rule that had just been found hiding
      this project from the cloud dashboard, one layer further out: **a settings
      file beats the process environment.** `.claude/settings.json` is checked
      out on the runner like any other file, and it points
      `OTEL_EXPORTER_OTLP_ENDPOINT` at `http://localhost:4317` for a laptop's
      collector. The workflow exported Grafana Cloud's endpoint; the checked-out
      file overwrote it; every run exported to a port nothing was listening on.

      Fixed by writing `.claude/settings.local.json` — *project local*, so it
      outranks the committed file — from `scripts/write-ci-telemetry-settings.mjs`
      before the action runs. That also carries
      `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE`, which
      `claude-code-action` does not forward: it passes exactly nine `OTEL_*`
      variables from `env` and that is not one of them, so the workflow could
      not have set it by any means.

      Worth keeping, because it is the third time in this file: every telemetry
      failure so far has been silent by construction. A wrong temporality, a
      wrong endpoint and an unforwarded variable all present as a green run and
      an empty panel, and the only thing that found any of them was reading the
      store's own attributes rather than trusting the config.

      A fourth, found while trying to prove the third: **the review job does not
      run on a pull request that edits a workflow file.** #43, which carried the
      fix, reported `claude-review` green in 11 seconds without starting a
      session at all —

      > Action skipped due to workflow validation error. This is expected when
      > adding Claude Code workflows to new repositories or on PRs with workflow
      > changes. If you're seeing this, your workflow will begin working once
      > you merge your PR.

      Sensible — a pull request must not be able to rewrite the workflow that
      reviews it — but it has two consequences worth holding on to. A change to
      CI can never be tested by its own pull request, so the first real exercise
      is always a *later* one; this entry is that later one. And `claude-review`
      reports success when it has done nothing, so a green tick on a
      workflow-touching pull request means "not reviewed", not "reviewed and
      clean".

      The same credential in `telemetry/.env` plus the compose overlay makes
      the laptop report to the same store, which is the point — otherwise there
      are two stores and no single answer to what the loop costs. That half is
      done; see the next item.

- [x] **The laptop reports only to the local Prometheus.** ~~The item above
      switches CI on. Nothing switched the laptop over to follow it, so the two
      halves of the same number are about to land in two different stores.~~
      Done on 2026-09-13: the credential is in `telemetry/.env` and the stack
      runs with both compose files, so the collector fans out to Prometheus and
      to Grafana Cloud.

      Switching it on immediately exposed something nobody had looked for, and
      it is the more useful half of this item. Settings merge with the *project*
      winning, so `.claude/settings.json` here — pointing at
      `http://localhost:4317` — overrides the machine-wide
      `~/.claude/settings.json` that sends every other project straight to
      Grafana Cloud. The repository that built the telemetry was the only one
      absent from the store it built. The cloud dashboard read one session and
      one active user, and that session was from a different project entirely.

      A second discovery followed within a minute of the overlay coming up. The
      collector's identity scrub, written for a local Prometheus, was being
      applied to the cloud export as well — and there it protected nothing,
      because every other session and every CI run reaches that same store
      carrying `user.email` directly. It did not remove the address from
      anywhere; it split one person in two. "Cost by team member" read
      `Value $0.57` beside a real address at `$0.49`, and "Active users" said 2
      for one human. The scrub now follows the destination rather than the
      source: anonymous on the way to disk here, intact on the way to the store
      that already holds it. `check.sh`'s `canary@example.com` is filtered out
      of the cloud pipelines by `service.name`, so proving the local scrub can
      never invent a team member in the shared one.

      Left open deliberately: with Docker down, a session in *this* repository
      now reports nowhere, while a session in any other project still reaches
      Grafana Cloud. The local collector is a single point of failure for this
      project's telemetry alone, and that is the price of keeping offline
      history.

- [x] **Merge notifications are credentialed, and the first live attempts
      failed.** #35 ships a workflow that messages Telegram on every merged pull
      request, and ~~it skips with an explanatory log line until
      `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set on the repository.~~
      both are now set — `TELEGRAM_CHAT_ID` at 08:13Z on 2026-09-13, which is
      the moment the job stopped skipping and started sending. The send path
      itself is proven — a message was delivered through the same Bot API call
      the workflow makes — but not from a runner.

      Every merge since then failed: #37, #38 and #39, at 08:18Z, 08:20Z and
      08:36Z, each answered
      `{"ok":false,"error_code":404,"description":"Not Found"}`. A 404 on
      `/bot<token>/sendMessage` is Telegram saying the *token* is wrong rather
      than the chat — the path itself does not resolve, so nothing was even
      looked up. ~~The token was re-set at 13:09Z, after all three runs, so the
      fix is unproven until the next merge fires the workflow.~~ Proven: the
      merges of #40 at 13:27Z and #41 at 13:30Z both ran the workflow green and
      both messages arrived. A wrong token was the whole of it.

      Two things the workflow got right, and both are why this was a red cross
      rather than a silence. The skip guard worked in the direction nobody
      tests: it let the job run precisely because both secrets were non-empty.
      And the verdict came from the *response body*, not the HTTP status —
      Telegram answers 200 with `"ok":false` for some of these, so a status
      check would have reported a clean success while no message arrived. That
      is the failure mode this workflow was written to avoid, and avoiding it is
      what made a wrong token visible within two minutes of the first merge.

      Worth deciding at the same time: that token also drives the Claude Code
      Telegram channel, and this repository is public. A second bot from
      BotFather used only for notifications would mean a leak in Actions costs
      nothing else.

## aia2

- [x] **No security review.** ~~The doc has automated code review *and* security
      review on by default at step 2. Code review is installed and working;
      `/security-review` has never run against this code.~~ Ran 2026-09-12
      against the whole codebase, because there was no diff to review — the
      branch was clean and there is no `main` on the remote, which is also what
      broke `/security-review`'s own `origin/HEAD` lookup. Six findings, all
      under repair in parallel; the ones nobody is fixing are recorded under
      `aia0` above, because they are governance decisions rather than bugs.
- [ ] **Agent view unused.** `ctrl+o` is the orchestration surface for exactly
      the parallel work already done here, and it has not been opened once.
- [ ] **Parallelism proven only at two agents**, on deliberately disjoint files.
      Untested: five or more, two agents touching the same file, a PR going
      stale while another merges, and the Railway PR-environment ceiling.

      2026-09-12 pushed this to four agents at once on the security findings,
      still on deliberately disjoint files. What it taught:

      - **Four held.** Four worktrees, four simultaneous Railway PR
        environments, four concurrent `npm run verify` runs, no collisions.
        `scripts/ports.mjs` deriving ports from the worktree directory name is
        what made the last of those a non-event.
      - **Sequential merges needed no rebasing.** All four stayed
        `MERGEABLE/CLEAN` as the others landed, because the ruleset does not
        require branches to be up to date. Disjoint files plus that setting is
        why "a PR going stale while another merges" never arose — it is not
        yet evidence that it would not.
      - **A brief with a wrong API in it is recoverable.** Two agents
        contradicted their instructions and were right to: `StrawberryConfig`
        has no `disable_introspection` field in 0.327.7 (the extension is the
        mechanism), and `vi.mock` does not reliably intercept Node builtins
        from inside an ESM module under test. Both said so and chose
        differently. A brief is a starting position, not a spec.
      - **Cleanup is the ragged edge.** `git worktree remove --force`
        deregistered all four but could not delete the directories: Windows
        held locks on `node_modules` and `.venv`. The registry and the disk
        disagreed afterwards, which is a trap for the next run that reuses a
        name.

      Still untested: five or more, and the case that actually matters — two
      agents wanting the same file.

- [ ] **The backlog cannot be claimed.** This file is a document *about* work,
      sitting outside the system that does the work. Four agents running at once
      cannot tick a box in it without fighting each other over the same lines,
      so in practice a human edits it afterwards from memory, which is how items
      go stale. Whatever replaces it has to let the work itself close the item,
      so that a merged pull request is what moves the backlog. The pull request
      that added this entry carries a concrete proposal.
- [ ] **Team plan gates several step-2 items** — analytics, per-seat spend caps,
      and Claude Tag. A purchase decision rather than an engineering one.
