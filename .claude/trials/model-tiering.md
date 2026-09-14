# Model tiering trials

Whether cheaper models can do some of the work here, and where the return stops
being worth it. A working record, not published documentation.

The question is not "is Sonnet good at coding". It is **which activities in
this repository can be done by a cheaper model without producing slop that a
green `verify` would not catch.**

## How a trial is run

One task. Identical brief. The model is the only variable.

The three roles live in `.claude/agents/` — `implementer`, `code-checker`,
`security-checker` — and **none of them pins a model**, deliberately. A
per-invocation model beats a definition's, so pinning would make the variable
harder to see rather than easier. The role file carries the standing
instructions; the prompt carries the task; the spawn carries the model.

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

Ten Opus agent runs on 2026-09-13/14, across issues #47–#59 and the aia0 set.
Useful as context, not as a control — the tasks differ. What it establishes:

- Typical cost per implementation agent: **57k–127k tokens**
- Two of ten needed a rework round, both for the same defect class: a control that was present and inert
- The strongest work came from judgement a verifier cannot check — reimplementing a region-strip independently rather than calling the function under test; noticing `AbortSignal.timeout` is unavailable on the build's actual Safari target

That last point is the thing to watch in a cheaper arm. It is invisible to CI.

---

## Trial 1 — an MCP server over the family tree

**Subject:** `apps/mcp/`, exposing the tree over MCP. Chosen because it is
additive (no collision with other work), has a real oracle (`npm run verify`),
and contains one genuinely discriminating decision: relationship naming must
reuse the derivations in `api.tree` rather than re-deriving them, which is the
project's central rule and is not something a test would catch being broken.

**Arms:** `implementer` at `opus`, `implementer` at `sonnet`. Same brief.

**Status:** running.

| | Opus | Sonnet |
| --- | --- | --- |
| Tokens | | |
| Wall-clock | | |
| `verify` first time | | |
| Rework rounds | | |
| Slop findings | | |
| Verdict | | |

Results below once both arms report.
