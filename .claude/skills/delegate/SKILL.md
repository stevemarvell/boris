---
name: delegate
description: When and how the main session hands a change to the implementer agent, or a review to code-checker / security-checker — what a brief must contain, how many to run at once, and how the result comes back. Read before spawning any agent from .claude/agents/.
---

# Handing work to an agent

`.claude/agents/` holds three roles. Each file is the agent's *standing*
instructions; it knows nothing about the task until the brief says so. The
role file carries the rules, the brief carries the task, the spawn carries the
model (each is pinned to Sonnet; pass `model` only for a deliberate trial —
`.claude/trials/model-tiering.md`).

| Agent | Does | Writes |
| --- | --- | --- |
| `implementer` | One change, end to end: code, tests, `verify`, pull request. Never merges. | yes, in its own worktree |
| `code-checker` | Correctness and quality review of a diff or pull request. | nothing |
| `security-checker` | Exposure review against `docs/data-governance.md`. | nothing |

CI already runs both checkers on every pull request (`claude-code-review.yml`).
Spawn one by hand only for a review CI cannot do — a pull request that edits
`.github/workflows/`, where `claude-code-action` refuses to run.

## When to delegate, and when not

Each agent costs 57k–144k tokens and loads `CLAUDE.md` again (SOP 4). So:

- **Do it yourself** when the change is small, touches a file or two, or
  depends on context this session already holds. Briefing costs more than
  doing.
- **Delegate** when there are independent changes that can run in parallel —
  typically the picks from one `work-backlog` triage that touch different
  files — or when the work would flood this session's context with output it
  will not need again.
- **Never** delegate an issue labelled `human`, `do not automate`, `blocked…`
  or `template`. `scripts/triage.mjs` already excludes them; a hand-picked task
  gets the same check.

**Ceiling: 3 implementers at once**, matching `MAX_ISSUES_PER_RUN`. More
overlap means more `contention` and more context spent.

## The brief

An implementer starts cold. The brief must carry everything the role file says
comes from the prompt:

1. **The task**, and the issue number if there is one — the agent writes
   `Closes #<n>` from it.
2. **The done-when**, copied from the issue rather than paraphrased.
3. **The files it owns.** It is told to stay inside them, so a missing file
   becomes a report instead of a change. Two parallel agents never own the same
   file.
4. **What you already know**: the cause if you found it, what you ruled out,
   anything surprising. Do not make it rediscover facts.

Spawn it with worktree isolation (`isolation: "worktree"` on the Agent tool) so
its checkout, ports and branch are its own — see the `worktrees` skill.

## When it comes back

The report is a claim, not evidence. Its pull request is the work:

1. Read the diff. Check that it stayed inside its files and did what the brief
   asked — not only that `verify` is green.
2. Run `drive-pr <n>` on the pull request. That polls checks, works the review
   findings, merges, and confirms smoke.
3. Rework goes back to the **same** agent (SendMessage), not a fresh one, and at
   most **2 rounds** (SOP 1). After that, finish it yourself or stop and report.
4. Clean up its worktree once the pull request merges (`worktrees` skill).

An agent that stopped at a ceiling or left something out says so first in its
report. Take that at face value: it is the procedure working, and the
leftover is yours to do or to report.
