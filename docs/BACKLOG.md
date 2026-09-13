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
      no control at all. Note that GitHub Pages on a private repository needs a
      paid plan, and Vercel preview URLs are currently public by deliberate
      choice so agents can read them.

      The security review of 2026-09-12 leaned on this one twice: the `@claude`
      workflow can be triggered by any stranger's comment, and the API is open
      to the world. Both are only acceptable while the data is invented.

- [ ] **No rate limiting anywhere.** The depth limit in flight caps what a
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

## aia1

- [ ] **No telemetry.** Nothing measures token use, active time, or output per
      merged change. A subagent already died mid-task on a session limit, which
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

      In flight: PR #29 skips the console step and ships the durable version —
      OTLP collector, Prometheus, Grafana, `telemetry/`. Metrics only, so the
      redaction above is preserved by never opening the events pipe. Verified
      against the running stack, which is how it was caught that the first
      version of the scrub silently did not scrub.

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
      still on deliberately disjoint files, plus four simultaneous Railway PR
      environments and four concurrent `npm run verify` runs. Whatever that run
      taught belongs here; the remaining untested cases are the ones where two
      agents want the same file.

- [ ] **The backlog cannot be claimed.** This file is a document *about* work,
      sitting outside the system that does the work. Four agents running at once
      cannot tick a box in it without fighting each other over the same lines,
      so in practice a human edits it afterwards from memory, which is how items
      go stale. Whatever replaces it has to let the work itself close the item,
      so that a merged pull request is what moves the backlog. The pull request
      that added this entry carries a concrete proposal.
- [ ] **Team plan gates several step-2 items** — analytics, per-seat spend caps,
      and Claude Tag. A purchase decision rather than an engineering one.
