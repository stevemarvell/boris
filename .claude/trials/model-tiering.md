# Model tiering trials

Whether cheaper models can do some of the work here, and where the return stops
being worth it. A working record, not published documentation.

The question is not "is Sonnet good at coding". It is **which activities in
this repository can be done by a cheaper model without producing slop that a
green `verify` would not catch.**

## How a trial is run

One task. Identical brief. The model is the only variable.

The three roles live in `.claude/agents/` — `implementer`, `code-checker`,
`security-checker`. As of 2026-09-21 all three are pinned to `sonnet` — the
"Current recommendation" table below is exactly what the pin sets. A
per-invocation model still beats a definition's, so a trial arm passing its
own `model` (`implementer` at `opus`, `implementer` at `sonnet`) overrides
the pin the same way it always overrode an unset default; the variable a
trial varies is untouched. What changed is the baseline a spawn gets when
it passes none — previously the session default, now Sonnet. The role file
carries the standing instructions; the prompt carries the task; the spawn
carries the model, when a trial needs one other than the default.

Each arm gets its own worktree and opens a pull request. Nothing merges until
the comparison is done, so both arms can be read side by side.

## What gets measured

**Objective, from the run itself:**

| | |
| --- | --- |
| Tokens | reported per agent |
| Wall-clock | reported per agent |
| `verify` green on first submission | yes / no |
| Rework rounds needed | SOP 1 caps this at 2 |
| CI | `verify`, `image`, `claude-review` |

**Slop, which is the part a green build does not show.** Named so a reviewer
can check rather than form an impression:

- **Circular test** — computes its expected value by calling the code under test
- **Inert control** — a guard nothing observes; the failure this repo has had four times
- **Wrong-environment check** — verified where the production constraint is absent (`TestClient` has one client key; `curl` has no CORS)
- **Unrequested scope** — files or behaviour beyond the brief
- **Abstraction with one caller**
- **Unbacked claim** — "should work", "this ensures", with no run behind it
- **Missed trap** — the brief pointed at a hazard and the work walked into it
- **Comment restating the code**

A single circular test or inert control outweighs a faster, cheaper run. Those
are exactly the defects that ship green.

## Baseline already paid for

Ten Opus agent runs across the aia0 issue set.
Useful as context, not as a control — the tasks differ. What it establishes:

- Typical cost per implementation agent: **57k–127k tokens**
- Two of ten needed a rework round, both for the same defect class: a control that was present and inert
- The strongest work came from judgement a verifier cannot check — reimplementing a region-strip independently rather than calling the function under test; noticing `AbortSignal.timeout` is unavailable on the build's actual Safari target

That last point is the thing to watch in a cheaper arm. It is invisible to CI.

---

## Trial 1 — an MCP server over the family tree

**Subject:** `apps/mcp/`, exposing the tree over MCP (the family tree and its
MCP server have since been removed from `apps/`; the trial's findings about
model behaviour still hold). Chosen because it is
additive (no collision with other work), has a real oracle (`npm run verify`),
and contains one genuinely discriminating decision: relationship naming must
reuse the derivations in `api.tree` rather than re-deriving them, which is the
project's central rule and is not something a test would catch being broken.

**Arms:** `implementer` at `opus`, `implementer` at `sonnet`. Same brief.

**Result.** Both arms shipped pull requests. Both green in CI, both reused
`FamilyTree` without re-deriving anything, both independently found three things the
brief did not mention — the SDK had moved to `mcp` 2.x (`FastMCP` is now `MCPServer`),
the SDK replaces any non-`ToolError` message with a generic string, and
`data/family.json` contains no half-siblings at all.

| | Opus | Sonnet |
| --- | --- | --- |
| Tokens | 143,958 | 137,066 |
| Wall-clock | 17m 18s | 9m 27s |
| Tests written | 73 | 24 |
| `verify` green first time | yes | yes |
| Rework rounds | 0 | 0 |

**Mutation testing of both suites.** Self-reports are not evidence, so each suite was
run against deliberate breakage:

| Mutation | Sonnet | Opus |
| --- | --- | --- |
| Swap the `parent`/`child` result | 2 fail | 5 fail |
| Remove the `ToolError` message translation | 2 fail | 4 fail |

Neither suite is vacuous. Opus has more redundancy; both catch what matters.

**The difference that decided it, and it was not found by mutation.** Sonnet's
`verify:mcp` omits `--frozen`, so `apps/mcp`'s lockfile resolves live and drifts
silently. `verify.yml` carries that guard for `apps/api` with a comment explaining
exactly why. Opus included it and said why. Mutation testing missed this because it
mutates logic, and this is dependency configuration — a reminder that an oracle only
covers what it observes.

Opus also centralised the error translation in one site against Sonnet's two, drove
the server over real stdio in a separate process rather than only in-process, and
worked out that `editable = true` is load-bearing because `default_data_path()` walks
up from the module's own location.

**Verdict on implementation:** Sonnet reached the same place for 5% fewer tokens in
55% of the wall-clock, and left one inert-control defect behind. Viable **with a
review gate**. Not viable without one.

---

## Trial 2 — can the review tier down

Same pull request as Sonnet's arm above, same brief, two reviewer models.

| | Sonnet | Haiku |
| --- | --- | --- |
| Tokens | 84,940 | 76,327 |
| Wall-clock | 226s | 232s |
| Findings | 2 | **0** |
| Found the `--frozen` gap | yes, **reproduced** it | no |
| Verdict given | would not merge | would merge |

Haiku's review is articulate and specific — it names individual tests, quotes the
comment about circular tests, confirms the reuse constraint. It reads like diligence
and contains nothing. It cost 10% fewer tokens than Sonnet's and missed every finding.

Sonnet's reviewer did not know more. It **ran an experiment**: pinned
`pytest==8.0.0`, ran `npm run verify:mcp`, and watched `uv.lock` get rewritten with no
failure and no warning. Haiku read the diff and described it.

---

## What these two trials say

**The line is not difficulty. It is whether the model's output is itself the check.**

- Where output is **checkable by something else** — an implementation behind `verify`,
  a retrieval answer with citations — a cheaper model is safe, because a mistake is
  caught mechanically. Sonnet implementing behind a review gate; Haiku answering a
  documentation lookup that was afterwards verified verbatim against the source.
- Where the output **is** the check — a code review, a security review, a judgement
  about whether a guard actually guards — a cheaper model fails silently and
  expensively. There is nothing downstream to catch it, and the failure arrives
  looking like assurance.

**Current recommendation**

| Work | Model | Why |
| --- | --- | --- |
| Reading logs, CI output, documentation lookup | Haiku | Answer is checkable against the artifact; the win is context, not tokens |
| Implementation of a specified change | Sonnet | Behind `verify` **and** a Sonnet-or-better review |
| Code review, security review | Sonnet minimum | Haiku produced a confidently empty review |
| Design decisions, debugging from a symptom, orchestration | Opus | No oracle exists |

**Do not set `CLAUDE_CODE_SUBAGENT_MODEL`.** Leaving it unset means a subagent with
no pin of its own falls back to the session model, so cheapness stays opted into
per spawn rather than defaulted into. That matches how `API_ENVIRONMENT` defaults
to `production` — but it is no longer the whole story for the three roles this file
is about. `implementer`/`code-checker`/`security-checker` now carry `model: sonnet`
in their own frontmatter, which sits ahead of the session model in the resolution
order stated above. Leaving the model unset at spawn for these three falls back to
Sonnet, not the session model, whatever that session model is and whatever this
env var says. A role added here later with no frontmatter pin is the one this
paragraph's original claim still describes.

**Token honesty.** Sonnet is not dramatically cheaper per task — 137k against 144k
here. The real saving was wall-clock, and the real risk was a silent defect. Price per
token is not price per task.

## Open

- One task, one subject. `relationship_between` had a tighter spec than most work here.
- Neither arm was retried, so the rework-round column is untested.
- The Opus reviewer arm was not run; Sonnet-vs-Haiku answered the question that mattered.
