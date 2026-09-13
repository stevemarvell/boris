# Telemetry

Closes the `aia1` gap in [`../docs/BACKLOG.md`](../docs/BACKLOG.md): *nothing
measures token use, active time, or output per merged change.*

Claude Code emits OpenTelemetry metrics and events. This directory is the
collector that catches them — OTLP in, Prometheus in the middle, one Grafana
dashboard on top.

```
claude ──OTLP/gRPC:4317──▶ otel-collector ──:8889──▶ prometheus ──▶ grafana:3000
```

By default every port is bound to loopback and nothing leaves the machine. Two
things deliberately change that, and both are opt-in:

- the **cloud overlay** below, which also forwards to Grafana Cloud
- the **GitHub Actions runs**, which cannot reach this laptop and so report to
  Grafana Cloud directly

Neither is on until a credential exists.

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

**Events on, content off.** `OTEL_LOGS_EXPORTER=otlp` is set, because Grafana
Cloud's Claude Code integration reads events as well as metrics and its
dashboards are half empty without them.

The line that matters is one step further in. Events on their own carry
*metadata* — which tool ran, how long it took, which model, which session.
Three separate variables turn them into the prompts and file contents
themselves:

```
OTEL_LOG_USER_PROMPTS      # your prompts
OTEL_LOG_TOOL_DETAILS      # tool inputs
OTEL_LOG_TOOL_CONTENT      # file contents read and written
```

**None of them is set anywhere in this repository, and none should be.** Unset
is off. They are deliberately absent rather than set to `0`, because `"0"` is a
truthy string in more places than it ought to be and absence cannot be
misread.

This is what the backlog meant by *"prompts, responses and tool inputs are
redacted by default; leave them that way"* — the redaction is those three flags,
not the pipe itself. An earlier version of this file kept the pipe shut
entirely, which was stricter than the rule asked and cost the integration's
dashboards.

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

## The unattended runs

Claude also runs in GitHub Actions — `claude-code-review.yml` on every pull
request, and `claude.yml` whenever someone tags `@claude`. That is the spend
least likely to be noticed, because nobody is sitting there while it happens.

It used to be invisible, and not for the reason this section previously
claimed. `claude-code-action` passes the nine OTel variables through from `env`
(see its `action.yml`), and all nine were empty — so CI telemetry was not
failing quietly against `localhost`, it was simply off.

Both workflows now set them. A runner cannot reach the collector on this
laptop, so CI ships straight to Grafana Cloud, and the overlay above sends local
metrics to the same place. One store, both sources, told apart by
`OTEL_RESOURCE_ATTRIBUTES`:

| Attribute | Laptop | CI |
| --- | --- | --- |
| `environment` | unset | `ci` |
| `workflow` | unset | `claude-code-review` or `claude-mention` |
| `run_id`, `run_attempt` | unset | the GitHub run |

Without that split, tokens per merged PR quietly absorbs the review bot and
stops meaning what the panel title says.

Two deliberate choices in those workflow blocks:

- **Gated on the credential.** `CLAUDE_CODE_ENABLE_TELEMETRY` is `1` only when
  `GRAFANA_CLOUD_OTLP_AUTH` is set. With telemetry on and no endpoint the
  exporter falls back to `localhost:4317` and every run ends retrying a
  connection to itself.
- **5s export interval, not 10.** A runner is destroyed the moment the job
  ends, and a flush on exit is not documented. A short review could otherwise
  finish between exports and report nothing at all.

### Switching it on

Grafana Cloud ships a **Claude Code integration** — Connections, the Claude Code
tile, Install. It provisions four dashboards (Claude Code, stats, usage
breakdown, productivity), which is why there is no cloud copy of the local
dashboard in this repository: theirs is better and already exists.

1. Grafana Cloud Portal, your stack, the **OpenTelemetry** tile, Configure.
   Generate a token; it prints the `OTEL_*` variables ready-made.
2. Install the **Claude Code** integration from Connections.
3. Set two repository secrets:
   - `GRAFANA_CLOUD_OTLP_ENDPOINT` — the endpoint, ending `/otlp`
   - `GRAFANA_CLOUD_OTLP_AUTH` — the whole `OTEL_EXPORTER_OTLP_HEADERS` value,
     `Authorization=Basic <base64>`
4. Optionally put the same credential in `.env` and run the overlay, so the
   laptop reports to the same store. The spelling differs between the two —
   see `.env.example`.

Until step 3, both workflows run with telemetry off, exactly as before.

### The variable that decides whether any of it works

`OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=cumulative`, required by the
integration and set in all three places here.

Claude Code can emit *delta* temporality. A Prometheus-backed store — Grafana
Cloud's, and the local one — drops delta sums on the floor. There is no error,
no warning, and nothing in any log: the panels simply read "No data", which
looks exactly like a wrong metric name, a broken scrape, or a session that never
reported. It went unnoticed here until Grafana's own integration docs spelled it
out.

<https://code.claude.com/docs/en/monitoring-usage>
