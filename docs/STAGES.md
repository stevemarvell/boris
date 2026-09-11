# Climbing the ladder in this repo

Five steps, from one supervised agent to a thousand. Each step below has a
**drill** you can actually run here and an **exit test** — the observable thing
that proves you have earned the next step. Do not skip ahead: the bottleneck at
each step is the thing that makes the next step safe.

The one idea underneath all of it: **you can only delegate as far as your
verification loop can be trusted.** In this repo that loop is `npm run verify`.

---

## Step 0 — Gated

*Agents: 0. Nothing is approved yet.*

Nothing to do here in code. This step is procurement and policy: model access,
SSO, budget caps, somewhere to host what gets built. If you are reading this
repo on your own machine, you are past it.

**Exit test:** you can run an agent against a real repo without filing a ticket.

---

## Step 1 — Assisted

*Agents: ~1. You and one agent, as a pair.*

One session, one change at a time. You read almost every diff before it merges.

### Drill

Work three items from `docs/BACKLOG.md` marked `[S1]`, one at a time, in a
single session. For each one:

1. Ask for a plan first (`shift+tab` into plan mode), read it, correct it.
2. Let the agent implement, then **make it run `npm run verify` itself** before
   you look at anything.
3. Review the final diff, not the keystrokes.

### What to notice

The first time you catch yourself reading a diff you already know is fine, that
is the bottleneck the doc names: *your attention*. You are the rate limiter, and
you are being paid to watch a loop that already works.

### Exit test

You have run `npm run verify` enough times to believe a green result. Concretely:
an agent tells you it is done, `verify` is green, and you merge without opening
every file. Also — turn on auto mode (`/auto`) so permission prompts stop
blocking, and check `.claude/settings.json`, which already pre-approves the safe
commands in this repo.

---

## Step 2 — Parallel

*Agents: ~10. You are an orchestrator.*

Several agents at once, each isolated, each self-verifying.

### Drill

Pick five backlog items marked `[P]` (parallel-safe — they touch disjoint
files). Launch each in its own worktree so they cannot collide:

```bash
git worktree add ../boris-search   -b feat/search-operators
git worktree add ../boris-export   -b feat/export
git worktree add ../boris-archive  -b feat/archive
# ...one terminal per worktree, one agent each
```

In Claude Code, `/worktree` does this for you, and agent view (`ctrl+o`) shows
all the running sessions at once. Each agent's brief is the same three lines:

> Implement `<item>` from docs/BACKLOG.md. Add tests. `npm run verify` must pass
> before you report done.

While they run, do not watch. Go and write the brief for the next one.

### What to notice

Your job has changed shape. You are no longer writing code or even reading much
of it — you are writing briefs, checking green ticks, and resolving the one
agent that got stuck. The new bottleneck is **review**: five diffs arriving at
once, all plausible, all needing judgement.

That is what `/code-review` and `/security-review` are for. Run them on each
branch before you merge, so your own reading is the third pass, not the first.

### Exit test

Five branches merged in an afternoon, each one green, none of which you
hand-edited. If you had to fix an agent's work yourself, the loop was not tight
enough — add the missing check to `verify` or the missing rule to `CLAUDE.md`
and try again. **Every fix you make by hand is a bug in the loop.**

---

## Step 3 — Supervised autonomy

*Agents: ~100. You manage managers.*

Claude writes essentially all the code. The question stops being "did you read
it?" and becomes "what context was it missing, and how do I supply that
permanently?"

### Drill

Three things to build here, in order:

1. **Encode what you keep repeating.** Every correction you gave at step 2 that
   you have now given twice belongs in `CLAUDE.md` or a skill in
   `.claude/skills/`. This is the highest-leverage work at this step and it is
   almost always neglected.
2. **Fan out with routines.** The backlog has a `[LOOP]` section of repetitive,
   near-identical work — exactly what `/loop`, `/batch`, and subagents are for.
   One brief, many targets, no supervision per target.
3. **Let Claude start Claude.** Schedule a routine that opens the repo, finds
   the highest-value `[AUTO]` item, does it, and reports. You review outcomes on
   a cadence rather than tasks on arrival.

### What to notice

The tree is now too deep to babysit, and the trap is scaling agent count before
the loop has earned it. Watch cost as well as correctness — token use per merged
change is the number that tells you whether this is working. The question to ask
of any autonomous run is the doc's question: *is this something an engineer
would have done?*

### Exit test

Work lands that you did not kick off, it is good, and you find out about it
after the fact and are fine with that.

---

## Step 4 — AI-native

*Agents: ~1,000+. You steer by intent.*

Most agents are started by Claude, not by you. You set direction and monitor by
exception.

### Drill

The honest drill at this step is not in this repo — it is a real codebase with a
real migration. But you can rehearse the shape here:

- Use the **Claude Agent SDK** to build a small program that reads
  `docs/BACKLOG.md`, picks up unclaimed items, runs an agent per item in its own
  worktree, and opens a PR only when `verify` is green.
- Give it a budget and a model policy, and let it run on a schedule.
- Measure: merged changes per day, cost per merged change, rollback rate.

### Exit test

You describe an outcome, not a task, and the system decomposes it. Your
attention goes to the exceptions only.

---

## Honest signals you have moved too fast

- You are re-reading full diffs at step 3 → the loop is not trusted; go back and
  strengthen `verify`.
- Agents keep making the same mistake → it belongs in `CLAUDE.md`, not in your
  next prompt.
- Parallel agents collide → they are not in separate worktrees, or the task
  split is wrong.
- Cost climbs faster than merged changes → you scaled agent count instead of
  loop quality.
