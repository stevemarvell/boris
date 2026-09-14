# Standard operating procedures

How agent work is run in this repository. These are the procedures that govern
*how* work is done rather than *what* the code does — the things that are true
across every task, and that nobody should have to rediscover.

Each procedure states what it requires, what enforces it, and — where nothing
does — says so plainly. A rule nobody can check is a convention, and calling it
a control is how this project has been bitten four times already.

---

## SOP 1: Every loop declares a maximum

**Every skill, command, and agent declares a ceiling on how many times it will
retry, and reports when it reaches it.**

An agent that retries until it succeeds has no upper bound on cost. It is not a
hypothetical: a subagent has already died mid-task on a session limit in this
repository, and two more did during the seven-agent run of 2026-09-14. A loop
that stops and says *"I tried three times, here is what failed"* is worth more
than one that spends a budget silently and is killed halfway through.

### What the ceiling means

On reaching the ceiling, **stop and report**. Do not continue, do not start
again from the top, and do not quietly reduce the scope to something that
passes. The report says what was attempted, what failed each time, and what is
left — so the next attempt, by a person or another agent, starts informed.

Reaching a ceiling is not a failure to hide. It is the procedure working.

### The declared ceilings

| Loop | Ceiling | Where it is declared |
| --- | --- | --- |
| `verify` → fix → `verify` | 3 attempts | `.claude/commands/ship.md` |
| `verify` run and report | 1 attempt | `.claude/commands/gate.md` |
| Sending an agent back for rework | 2 rounds | this document |
| Polling a deployment in `smoke` | 30 attempts × 15s, 40 for the commit gate | `.github/workflows/smoke.yml`, per loop |

`smoke.yml` is the model the rest of this follows. Every one of its waits is a
`for attempt in $(seq 1 30)` with an explicit `sleep`, an echo per attempt, and
a distinct message on exhaustion. The ceiling is visible in the file, the
progress is visible in the log, and running out is a specific failure rather
than a timeout. That is what a bounded loop should look like.

### What enforces this

**Today: nothing mechanical, for the model-driven loops.** SOP 1 is a
discipline that a session follows by reading it. Be honest about that rather
than writing a `max_iterations` key into frontmatter that no harness reads —
this repository's recurring failure is a control that is present, plausible,
and inert, and inventing a config key nobody consumes is precisely that shape.

Two loops *are* mechanically bounded:

- `smoke.yml`'s waits, by the `seq` bounds above.
- The rate limiter, at 120 requests per minute — see `docs/data-governance.md`.

One more could be, and is the obvious next step: `.claude/hooks/verify-on-stop.mjs`
blocks the end of a turn while `verify` is red by exiting 2, which is what
creates the fix-and-retry loop in the first place. It has no notion of how many
times it has already done so. A counter there, refusing to block after the
third consecutive time and reporting instead, would make SOP 1 real for the
loop that matters most. Tracked as issue #80.

---

## SOP 2: Work that needs a person is labelled, not attempted

Some tasks cannot be finished by an agent, and the cost of finding that out by
trying is a wasted session and a plausible-looking report about work that did
not happen.

Where a human is genuinely required — testing something subjective, reading a
dashboard behind a login, making a purchase, deciding a trade-off that is not
ours to make — the issue carries **both** labels:

- **`human`** — a person has to do this part
- **`do not automate`** — and an agent should not start it first

and is assigned to the person who will do it.

Both labels, not one. `do not automate` alone says *stop*; `human` alone says
*someone should*. Together they say who, and that the stopping is deliberate
rather than an oversight.

An agent picking up work checks for these before starting. An agent that finds
one mid-task stops at that point and reports what remains, rather than
inventing a way around it.

---

## SOP 3: A control is verified where it runs

Not in the test suite. On the deployment.

Four controls in this repository have been present, running, and doing nothing,
each with a green test suite at the time:

| Control | Looked like | Actually did |
| --- | --- | --- |
| OTLP temporality | configured | exported nothing usable |
| OTLP endpoint | set by the workflow | overridden to `localhost` by a checked-out file |
| slowapi's `SlowAPIMiddleware` | installed and running | exempted every request |
| The rate limiter's client key | returning correct `x-ratelimit-*` headers | enforced 5× the configured limit |

The last one is the clearest. Its 84 unit tests passed throughout, because
`TestClient` is one process with one stable key and the deployment is neither.
It took 600 concurrent requests against a live Railway environment to see it.

So: when a change adds a control, exercise it against the deployed pull request
environment — `api-boris-pr-<number>.up.railway.app` — and put the real output
in the pull request body. A test proves the code does what you wrote. Only the
deployment proves the deployment does.
