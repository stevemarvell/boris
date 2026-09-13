# Telemetry

Closes the `aia1` gap in [`../docs/BACKLOG.md`](../docs/BACKLOG.md): *nothing
measures token use, active time, or output per merged change.*

Claude Code emits OpenTelemetry metrics. This directory is the collector that
catches them — OTLP in, Prometheus in the middle, one Grafana dashboard on top.
Everything runs on loopback; no data leaves the machine.

```
claude ──OTLP/gRPC:4317──▶ otel-collector ──:8889──▶ prometheus ──▶ grafana:3000
```

## The number this exists to produce

**Tokens per merged pull request.** Token spend on its own says nothing — it
falls when you do less and rises when you do more. Divided by merged changes it
becomes a rate, and a rate can be compared week to week. `claude_code.active_time.total`
is the second axis: it separates *this took a lot of tokens* from *this took a
lot of me*.

## Running it

```bash
cd telemetry
cp .env.example .env        # then set your own Grafana admin credentials
docker compose up -d
```

Then **restart Claude Code**. The exporter settings are read when a session
starts, so the session you are sitting in when you first pull this will not be
reporting — that is the setting not being live yet, not the stack being broken.

Grafana is at <http://localhost:3000>, dashboard **Claude Code — cost of the
loop**. Prometheus is at <http://localhost:9090> if you want to poke at raw
series. Metrics land within `OTEL_METRIC_EXPORT_INTERVAL` (10s), and counters
need two exports before `increase()` has anything to say — a brand new stack
looks empty for the first half-minute. That is the stack working, not failing.

`docker compose down` stops it; `docker compose down -v` also discards the
90 days of history.

## What is switched on, and what is not

[`../.claude/settings.json`](../.claude/settings.json) carries the exporter
config, so the setting is visible to everyone working here rather than living
in somebody's shell profile — the same rule the deployment config follows.

**Metrics only.** `OTEL_LOGS_EXPORTER` is deliberately unset. Turning it on
ships *events* — including `claude_code.user_prompt` and
`claude_code.tool_result` — and the content controls (`OTEL_LOG_USER_PROMPTS`,
`OTEL_LOG_TOOL_CONTENT`) then decide how much of your prompts and file contents
get written to disk. The backlog entry says to leave redaction on. This leaves
it on by not opening the pipe at all.

The collector also deletes `user.email`, `user.id`, `user.account_uuid`,
`user.account_id` and `organization.id` before anything is stored. A
single-developer stack does not need to know who the developer is, and metric
labels are forever.

That scrub takes **two** processors, `resource/scrub` and `attributes/scrub`,
and the duplication is load-bearing. Claude Code sends identity as *resource*
attributes; the `attributes` processor only sees datapoint attributes; and
`resource_to_telemetry_conversion` promotes resource attributes to Prometheus
labels inside the exporter, which runs after every processor. A config carrying
only the `attributes` processor reads as though it scrubs and does not. That was
not theory — the first version of this file had exactly that bug, and a test
payload arrived in Prometheus labelled `user_email="steve@example.com"`. If you
edit these processors, re-run the check below.

`add_metric_suffixes: false` on the Prometheus exporter keeps the names as
Claude Code spells them — `claude_code_token_usage`, not
`claude_code_token_usage_tokens_total`. The dashboard queries the short names.

## Checking it works

```bash
docker compose up -d && ./check.sh
```

`check.sh` pushes one synthetic payload through the collector and asserts what
Prometheus ends up holding: that the metric names survive unsuffixed, and that
the identity attributes are gone. Both failure modes are silent otherwise — a
suffixed name shows up as a dashboard full of "No data" with nothing visibly
wrong, and a failed scrub shows up as nothing at all until someone reads the
labels.

## No Docker? Start here instead

The console exporter costs nothing and needs none of the above. It prints the
metrics to the terminal, which is enough to decide whether standing up the
stack is worth it:

```bash
CLAUDE_CODE_ENABLE_TELEMETRY=1 OTEL_METRICS_EXPORTER=console \
  OTEL_METRIC_EXPORT_INTERVAL=10000 claude
```

## Credentials

`.env` is gitignored. `.env.example` is the template, and it holds placeholders
only — this repository is public, so a password committed here is a password
published here.

## Known rough edge

`.claude/settings.json` applies in CI too, where nothing is listening on
`localhost:4317`. Exports fail quietly rather than breaking a run. If it ever
gets noisy, set `CLAUDE_CODE_ENABLE_TELEMETRY: "0"` in the workflow's `env:`
block rather than removing it here.

<https://code.claude.com/docs/en/monitoring-usage>
