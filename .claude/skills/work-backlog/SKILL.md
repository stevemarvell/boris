---
name: work-backlog
description: Works the open GitHub issue backlog unattended — runs scripts/triage.mjs to pick what an agent may take on (skipping human-owned, in-flight and dependent issues), works each pick to a merged pull request through drive-pr, and re-triages after every merge. At most three issues per run. Use when asked to "carry on with issues", "work the backlog", or to pick up whatever is next.
---

# Working the backlog

This is #151's first example: the work is chosen from repository state, not
written in advance. `scripts/triage.mjs` makes the choice by fixed, tested
rules; this skill acts on it. It is the "look first, then choose the recipe"
counterpart to `drive-pr`, which runs a known recipe.

## The loop — ceiling: 3 issues per run (`MAX_ISSUES_PER_RUN`)

1. **Triage.** Run `node scripts/triage.mjs`. It prints what to work, in
   order, what is deferred over the ceiling, and what is skipped and why.
   - Skipped means skipped. An issue labelled `human`, `do not automate` or
     `blocked…`, one an open pull request already claims, or one that depends
     on an open issue is not worked, whatever its rank.
   - An issue body's own instructions still apply. If it says to wait for a
     person, read its comments: work it only once a person has said go, and
     say where they did in the pull request.
   - If the plan warns it was truncated, stop and report; do not work from
     a partial list.
   - If there is nothing to work, say so and stop. That is a complete run.
2. **Work the first pick.** Read the issue and its comments. Then:
   - Isolate it in its own worktree (the `worktrees` skill).
   - Make the change with a test (`CLAUDE.md`'s rules), and run `npm run verify`.
   - Open a pull request against `develop`. Its body puts `Closes #<n>`, or
     `Refs #<n>` where the done-when is confirmed outside the repository, and
     pastes the triage plan that picked it, so the reason for the choice is on
     the record.
   - If the issue turns out to need a person, a dashboard, money, or a
     decision, don't open a pull request. Comment on the issue with what
     was found, label it `human` and `do not automate`, and count it as one of
     the three.
3. **Drive it.** Follow `drive-pr` for that pull request. Its own ceilings
   apply inside this one (40 polls, 2 fix rounds, 30 smoke polls).
   - If `drive-pr` stops on a ceiling, stop this skill too: report the
     pull request and what is left, and do not start the next issue.
4. **Re-triage.** After the merge and the smoke check, go back to step 1. The
   merge has changed the state: the issue is closed, a smoke failure may have
   opened a new one, and a dependency may have cleared. The next pick comes
   from the new plan, not from the first one.
5. **Stop at three.** After three issues have been worked, stop, even if
   the plan still has more. Report what was done and what the plan says is
   next.

## The record

Each run must be reconstructable from GitHub alone:

- each pull request body carries the triage plan that picked it;
- each finding on it has a reply (from `drive-pr`);
- each issue left for a person has a comment saying why.

The final report lists each issue worked, with its pull request, merge commit
and smoke result, and each issue skipped with the reason triage gave.
