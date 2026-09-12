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

## aia2

- [ ] **No security review.** The doc has automated code review *and* security
      review on by default at step 2. Code review is installed and working;
      `/security-review` has never run against this code.
- [ ] **Agent view unused.** `ctrl+o` is the orchestration surface for exactly
      the parallel work already done here, and it has not been opened once.
- [ ] **Parallelism proven only at two agents**, on deliberately disjoint files.
      Untested: five or more, two agents touching the same file, a PR going
      stale while another merges, and the Railway PR-environment ceiling.
- [ ] **Team plan gates several step-2 items** — analytics, per-seat spend caps,
      and Claude Tag. A purchase decision rather than an engineering one.
