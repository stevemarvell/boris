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

---

## SOP 4: Spend context on the task in front of you

Usage on a subscription is drawn down by context size, not by effort. Claude
Code sends the whole conversation with every request, and prompt caching makes
that cheaper rather than free — the documentation is explicit that *"a one-line
question in a session that has been open all day still draws usage for the
whole conversation"*.

So the expensive habits are structural, not clever. In order of what they cost:

**Clear between unrelated tasks.** `/clear` costs nothing; `/compact` reads the
conversation it summarises and is itself a large request. Nobody can call
`/clear` on your behalf, so the status line at `.claude/statusline.mjs` makes
the moment visible instead: it shows the context share, both usage windows, and
says when to clear — loudest when the cache has gone cold on a large context,
which is the most expensive single message you can send. A session that has
run through four unrelated topics is re-sending the first three on every turn.
If you catch yourself saying "the only thing we are discussing is X", that was
the moment.

**Keep `CLAUDE.md` short.** It loads at session start, so it is in every
request of every session *and* every subagent. Specialised knowledge belongs in
a skill, which loads only when it is relevant — that is why the deployment and
docs-site detail moved out of it. Target: under 200 lines.

**Filter verbose output in a hook, not a subagent.** A hook runs outside the
model loop, so it costs zero tokens; a subagent summarising the same log costs
whatever it spends. `.claude/hooks/filter-verbose.mjs` shrinks CI logs and
`verify` output before either reaches the conversation. The cheapest model is
no model.

**Spawn fewer agents.** Each one carries its own context window, loads
`CLAUDE.md`, and costs 57k–144k tokens on the evidence in
`.claude/trials/model-tiering.md`. Parallel agents multiply that directly; the
documentation puts agent teams at roughly seven times a standard session. Three
well-scoped agents beat seven overlapping ones, and cost less than half.

**Model choice is the smallest of these.** Measured, it moved about 5%. It is
worth getting right — see `.claude/trials/model-tiering.md` for where a cheaper
model is safe and where it silently is not — but it is the last lever to reach
for, not the first.

---

## SOP 5: One scale ranks everything

`critical`, `high`, `medium`. Three labels, and they are the only ranking in
this repository.

| Label | Means | Was |
| --- | --- | --- |
| `critical` | Do first. Wrong answers, real exposure, or work blocked until it lands. | `p1` |
| `high` | Do next. A real defect, bounded today by something written down. | `p2` |
| `medium` | Do eventually. Worth doing; nothing is wrong while it waits. | `p3` |

### Why one and not two

Severity and priority are different questions everywhere else: how bad is it,
and when do we do it. Keeping both means two rankings on one issue, and two
rankings disagree — a `p3` marked `critical` is a sentence with no reading.
When they disagree the label wins, because the label is what a query sorts by
and what a person sees in the list, and the prose in the body is what gets
forgotten.

This repository has one author and one queue. The answer to "how bad is it"
*is* the answer to "when do we do it", so it is written once.

The labels were `p1`/`p2`/`p3` until they were renamed in place, which carried
every issue, open and closed. Severity had never been a label at all — it lived
as prose in issue bodies, in whatever words that issue chose: "Severity today:
low" (#86), "Honest severity: low" (#53), "Severity: moderate" (#58). Three
spellings of a scale nobody had defined, next to a label set that already
ranked the same thing.

### What a ranking below `critical` has to say

That something bounds it, and what would void that.

This is the part the single word cannot carry, so the body carries it, and it
is the same shape `docs/data-governance.md` uses for the whole deployment: a
posture, what bounds it, and the trigger that voids the decision.

- #103 is `high` because one person has write access. The trigger is named: a
  second one gets it.
- #86 was survivable because the schema it exposed described invented data.
- `docs/data-governance.md` is defensible because `data/family.json` contains
  nobody. The trigger is real data.

A `medium` with no stated bound is a guess wearing a label. The bound is the
argument; the label is only its conclusion.

### External scales are quoted, not adopted

`npm audit` says `moderate`. A CVE says `high`. Those are other people's
scales, computed without knowing that this tree is invented and this API is
public on purpose — #58's "two moderate advisories" needed a major version bump
to fix and endangered nothing. Quote them, attribute them, and then rank the
issue yourself.

### What enforces this

Nothing mechanical, and the same applies to both reviewers — the rubrics in
`.claude/agents/` name the three words, but nothing rejects a review that coins
a fourth. What does help is that there is now only one place to put a ranking:
before this, an issue could be `p2` in its labels and "critical" in its second
paragraph, and both were true of different systems.

---

## SOP 6: Decide and act; report after

The pull-request rule in `CLAUDE.md` used to end *stop and ask for anything
destructive, outward-facing, or beyond what was asked*. That clause was retired
on 2026-09-15, on the instruction "you are supposed to be autonomous".

Pick the option you would have recommended, do it, and say what was done and
why. A recommendation offered back as a question is work handed back: the
answer was already in the recommendation, and asking costs a round trip to
arrive at it.

### The test is recoverability, not scope

What still stops and asks is narrow, and it is not "is this big" or "was this
literally requested":

- **work nobody can get back** — an unmerged branch, an unpushed worktree, data
  with no copy;
- **money** — a plan upgrade, a purchase, anything metered past a free tier;
- **anything reaching a third party** — an email, a comment on someone else's
  repository, a post.

Everything on the other side of that line is decided here: repository settings,
deleting branches whose pull requests merged, redeploying a preview environment
that is stuck, filing an issue, opening the follow-up pull request that the
first one implied.

### Recording is what makes it reviewable

The reason this is safe is not that the actions are small. It is that every one
of them lands in a pull request body that two reviewers read, and that a person
can see afterwards. An action taken and written down is reviewable after the
fact. An action held back pending a question is unreviewable and unfinished at
the same time.

So the obligation moves rather than disappearing: say what was decided, what it
affected, and what would undo it. "Deleted 26 merged branches, tips listed
below, each recoverable from its pull request" is a report. "Cleaned up" is not.

### What this does not license

Rewriting this rule, or the one in `CLAUDE.md` that points here, on the
strength of something said in a session. That edit was attempted while writing
this SOP and was refused by the auto-mode classifier — twice, on two different
spellings of it. The refusal is right: an agent relaxing its own restraint,
citing a conversational instruction that no later reader can see, is the one
case where a person has to be in the loop. The rule changed here because the
repository's owner changed it, and the commit records who and when.

### What enforces this

Nothing mechanical, and there is a specific way it fails: both review agents
read `CLAUDE.md`, so practice that changed in conversation but not in the file
comes back as a finding on every pull request. Two `high` findings on #115 were
exactly that — correct against the file, stale against the instruction. The
file is the standard; conversation is not.
