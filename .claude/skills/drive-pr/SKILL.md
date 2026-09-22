---
name: drive-pr
description: Given an open pull request number, drives it to green and merges it — poll checks, read both automated reviews, fix and reply to real findings (bounded), merge once clean, prune locally, then confirm the next smoke run. Use when asked to "drive PR #<n>", "get this PR merged", or to work an open PR to completion rather than hand it back half-checked.
---

# Driving a pull request to green

This is issue #149's first row: *"Drive a pull request to green: open → poll
checks → read both reviews → fix findings → reply → resolve → merge → prune"*
— done by hand eight times on 2026-09-21/22 alone. This skill is that
sequence, fixed, with every decision point written as a rule rather than left
to judgement, and every ceiling from `docs/sops.md` SOP 1 declared up front.

Takes one argument: the pull request number, `<n>`. Assumes a checkout of
that pull request's branch is available (this worktree, or run
`gh pr checkout <n>` first) — step 3 commits and pushes to it.

## The five steps

### 1. Poll checks until settled — ceiling: 40 polls × 30s

"Settled" is a fact about the exit code, not a guess from reading output:

```bash
for attempt in $(seq 1 40); do
  gh pr checks <n> --json bucket,name,link,state
  code=$?
  echo "attempt $attempt: gh pr checks exit=$code"
  [ "$code" != "8" ] && break   # 8 is gh's own "checks pending" exit code
  sleep 30
done
```

- Exit code `8` means pending — the only code this loop treats as "keep
  waiting".
- Any other exit code means settled: `0` is every check passed (or none
  required), non-zero-non-8 means at least one failed. Either way, stop
  polling and move to step 2.
- This runs longer than a single command should block for (40 × 30s = 20
  minutes) — launch it with `run_in_background` and wait for it, rather than
  a foreground call that will itself be interrupted.

**Ceiling hit** (still exit `8` after 40 attempts): stop. Do not merge, do
not start fixing findings against checks that never finished. Go straight to
step 5.

### 2. Read both automated reviews

`claude-code-review.yml` posts two kinds of comment, both authored by
`claude[bot]`, both readable without guessing which is which:

```bash
# Top-level verdict comments — one titled "Reviewing PR #<n>" (code review),
# one titled "Security review of #<n>" (security review).
gh api repos/{owner}/{repo}/issues/<n>/comments \
  --jq '.[] | select(.user.login=="claude[bot]") | {id, body}'

# Inline findings, if either review had any — tied to a file and line.
gh api repos/{owner}/{repo}/pulls/<n>/comments \
  --jq '.[] | select(.user.login=="claude[bot]") | {id, path, line, body}'
```

Either review may not have run at all — `review-scope.mjs` skips a review
outside its scope, and the top-level comment for a skipped review will simply
be absent. Absence is not a finding to chase; only what was actually posted
is.

A review with nothing to say states that plainly: **"No findings"** in the
code review, **"does this change belong on develop as it stands: yes"** with
no bulleted findings above it in the security review. Treat a comment
matching that shape as answered already — nothing to fix, nothing to reply
to. Everything else — a numbered/bulleted finding, an inline comment — is a
finding to work in step 3.

### 3. Fix real findings and reply — ceiling: 2 rounds (SOP 1, "sending an agent back for rework")

One round is: read every open finding from step 2, then for each one:

- **Reproduce it before trusting it.** Run the command, read the exact line
  cited, or exercise the code path the finding describes — the same standard
  `docs/sops.md` SOP 3 holds this project's own controls to. A finding that
  does not reproduce, or that turns out to be a decision `CLAUDE.md` or
  `docs/sops.md` already records on purpose (SOP 5's "medium with a stated
  bound" is not a defect), is **not fixed**.
- **A finding that reproduces is fixed.** Make the smallest change that
  removes it, with a test per the "every behaviour change ships with a test"
  rule if the fix changes behaviour.
- **Reply to every finding, fixed or not**, with what was done or why not:
  - Inline finding → reply in its own thread:
    `gh api repos/{owner}/{repo}/pulls/<n>/comments/<comment_id>/replies -f body="…"`
  - Top-level verdict comment → `gh pr comment <n> --body "…"` referencing
    which point it answers.
- Commit and push once per round, after all findings in that round are
  either fixed or answered — not per finding, so the branch never sits with
  a fix committed but unexplained.

Run `npm run verify` after each round's commit (its own ceiling is the 3
attempts `.claude/commands/ship.md` already declares — this step does not
get a separate budget for that).

**Round 2 exists only if round 1 left something unresolved** — a finding
still disputed, a fix that did not turn `verify` green, or new findings
posted against the round-1 push (the reviews re-run on `synchronize`). Redo
the same procedure once more.

**Ceiling hit** (something is still unresolved after round 2): stop. Do not
attempt a third round, do not merge with an unanswered finding. Go to step 5.

### 4. Merge and prune

Merge only when **both** are true, checked, not assumed:

- `npm run verify` is green on the branch's current head.
- Every finding from step 2 has a reply posted in step 3 (or needed none).

```bash
gh pr merge <n> --squash
```

The user's standing instruction is merge without asking once checks are
green — this is that instruction, executed, not re-asked.

Then prune locally (the remote branch is deleted automatically —
`delete_branch_on_merge` is a repository setting, see `CLAUDE.md`):

```bash
git worktree remove <path-to-this-worktree>   # if this PR was driven from its own worktree
git -C <main-checkout> fetch origin --prune
git -C <main-checkout> branch -d <branch-name>
```

### 5. On hitting a ceiling: stop, comment, report

Whichever step's ceiling was hit (step 1's poll, step 3's rounds, or
`verify`'s own 3 attempts inside step 3):

```bash
gh pr comment <n> --body "drive-pr stopped: <which ceiling>, after <n> attempts/rounds. <what was still failing>. <what is left to do>."
```

Then report the same thing back. This is the record SOP 1 asks for: what was
attempted, what failed, what is left — on the pull request, where the next
attempt (person or agent) starts from it instead of from zero.

---

## After a merge: check the next `smoke` run — ceiling: 30 polls × 30s

Once step 4 has merged, `smoke.yml` fires on the push to `develop`. Confirm
it, rather than assuming the merge was fine because `verify` was:

```bash
for attempt in $(seq 1 30); do
  run=$(gh run list --workflow smoke --branch develop -L 1 \
          --json databaseId,status,conclusion)
  status=$(echo "$run" | jq -r '.[0].status')
  echo "attempt $attempt: $run"
  [ "$status" = "completed" ] && break
  sleep 30
done
```

- **Settled** means `status == "completed"`. Anything else after 30 attempts
  (60 → wait, 30 × 30s = 15 minutes, matched to the workflow's own timeout)
  is the ceiling: stop and report that `smoke` never finished, without
  guessing at a result it never produced.
- **On `conclusion != "success"`**, pull the failing step's log tail and open
  an issue from it — the record this project's `smoke`-after-merge row
  currently has no mechanism for at all (issue #149's third row):

```bash
id=$(echo "$run" | jq -r '.[0].databaseId')
gh run view "$id" --log-failed > /tmp/smoke-failure.log
gh issue create \
  --title "smoke failed after merging #<n>" \
  --body "$(printf '%s\n\n```\n%s\n```\n' \
    "Refs #<n>. Failing step's log tail:" \
    "$(tail -n 60 /tmp/smoke-failure.log)")" \
  --label medium
```

Rank the new issue `medium` unless the log tail shows something that
contradicts `docs/data-governance.md`'s bounds (real data reachable,
authentication changed unexpectedly) — that ranks `critical` per SOP 5, and
the issue body says why.

This loop is deliberately separate from steps 1–5 above: it starts only
after a merge has actually happened, so a ceiling hit here never blocks or
un-merges anything — it only means the confirmation didn't complete, and
says so.
