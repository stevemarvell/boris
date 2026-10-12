---
name: drive-pr
description: Given an open pull request number, drives it to green and merges it — poll checks, read both automated reviews, fix and reply to real findings (bounded), merge once clean, prune locally, then confirm the next smoke run. Use when asked to "drive PR #<n>", "get this PR merged", or to work an open PR to completion rather than hand it back half-checked.
---

# Driving a pull request to green

Driving a pull request to green — open → poll checks → read both reviews →
fix findings → reply → resolve → merge → prune — is a repeated, mechanical
sequence. This skill is that sequence, fixed, with every decision point
written as a rule rather than left to judgement, and every ceiling from
`docs/sops.md` SOP 1 declared up front.

Takes one argument: the pull request number, `<n>`. The driver reads,
replies and merges; it does not commit to the pull request's branch. Fixes
in step 3 are committed and pushed by an `implementer` (the one exception is
a docs-only pull request the driver opened itself).

## The five steps

### 1. Poll checks until settled — ceiling: 40 polls × 30s

**If checks never register at all** — the bucket list stays empty well past
when `claude-code-review.yml` and CI normally start — check why before
polling blind:

```bash
gh pr view <n> --json mergeable,mergeStateStatus
```

`mergeable: CONFLICTING` or a `mergeStateStatus` of `DIRTY`/`BEHIND` is the
usual reason: GitHub does not register new checks against a head it cannot
test against the base. Fix it by merging `develop` into the branch — **not**
by rebasing, and never by force-pushing, which this repository's commands
deny:

```bash
git fetch origin develop
git -C <worktree-or-checkout> merge origin/develop   # resolve conflicts per SOP 8: union, not a choice, on tests
git -C <worktree-or-checkout> push
```

An `implementer` does this push, same as any other fix in step 3 — the
driver reads and reports, it does not commit to the branch itself (the
docs-only exception below still applies). Once the merge lands, `mergeable`
and `mergeStateStatus` clear and checks register normally; resume the poll
below.

"Settled" is a fact read from each check's `bucket`, not a guess from reading
output, and **not the exit code**. With `--json`, `gh pr checks` exits `0`
while checks are still pending: exit `8` only happens without `--json`, and
trusting the exit code alone will settle on a poll with checks still
pending.

```bash
for attempt in $(seq 1 40); do
  buckets=$(gh pr checks <n> --json bucket --jq '[.[].bucket] | join(" ")' 2>&1)
  echo "attempt $attempt: $buckets"
  # Right after a push GitHub has registered nothing yet: gh says "no checks
  # reported", or the list is empty. Both mean not yet settled.
  case " $buckets " in
    *" pending "*|"  "|*"no checks reported"*) sleep 30; continue;;
  esac
  break
done
```

- Any `pending` bucket, an empty list, or "no checks reported" means not
  settled. These are the only states this loop treats as "keep waiting".
- Otherwise it is settled: all `pass`/`skipping` means green, and any `fail`
  or `cancel` means at least one failed. Either way, stop polling and move to
  step 2.
- This runs longer than a single command should block for (40 × 30s = 20
  minutes) — launch it with `run_in_background` and wait for it, rather than
  a foreground call that will itself be interrupted.

**Ceiling hit** (still pending after 40 attempts): stop. Do not merge, do
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
- **A finding that reproduces is fixed, by an `implementer`, not by the
  driver.** Send it back to the agent that wrote the PR (`SendMessage` to
  it). If that agent is gone, spawn a fresh `implementer` whose prompt names
  PR `<n>` as the one to continue, so its "Continuing an existing pull
  request" instructions apply: it pushes to that branch and opens no new
  PR. The brief carries the finding, the reproduction, and the instruction to make
  the smallest change that removes it, with a test per the "every behaviour
  change ships with a test" rule if the fix changes behaviour. The driver
  never edits code in the PR's worktree, even a one-liner: the coordinator
  that edits code is no longer checking it. Docs-only PRs the driver opened
  itself are the exception.
- **A finding the implementer reports as needing a person** (a credential, a
  dashboard, money, an open decision) usually has no issue behind it. Open
  one with `gh issue create --body-file <file>`, rank it, label it
  `human` + `do not automate`, assign it, and link it in the reply to the
  finding. Write the body with a quoted heredoc, as for replies below: it
  quotes the implementer's report. A reply alone is not enough to clear
  step 4's merge gate.
- **Reply to every finding, fixed or not**, with what was done or why not:
  - Inline finding → reply in its own thread:
    `gh api repos/{owner}/{repo}/pulls/<n>/comments/<comment_id>/replies -F body=@/tmp/reply.md`
  - Top-level verdict comment → `gh pr comment <n> --body-file /tmp/reply.md`
    referencing which point it answers.
  - Write the body to the file with a quoted heredoc (`cat > /tmp/reply.md
    <<'MD'`), never by interpolating into a double-quoted `--body "…"`:
    replies quote CI and review output, and `$(…)` or a backtick in that text
    would be executed by the shell.
- Send one brief per round covering every finding that reproduced, so the
  implementer pushes the round's fixes together and the branch never sits
  with a fix committed but unexplained. Reply to each finding once its fix
  is pushed.

The implementer runs `npm run verify` before it pushes (its own ceiling is
the 3 attempts `.claude/commands/ship.md` declares — this step does not get
a separate budget for that); the driver confirms it from the checks.

**Round 2 exists only if round 1 left something unresolved** — a finding
still disputed, a fix that did not turn `verify` green, or new findings
posted against the round-1 push (the reviews re-run on `synchronize`). Redo
the same procedure once more.

**Ceiling hit** (something is still unresolved after round 2): stop. Do not
attempt a third round, do not merge with an unanswered finding. Go to step 5.

### 4. Merge and prune

Merge only when **both** are true, checked, not assumed:

- `npm run verify` is green on the branch's current head.
- Every finding from step 2 has a reply posted in step 3 (or needed none),
  and every one that needs a person has its own `human` issue linked in
  that reply.

```bash
gh pr merge <n> --squash
```

The user's standing instruction is merge without asking once checks are
green — this is that instruction, executed, not re-asked.

Then prune locally (the remote branch is deleted automatically —
`delete_branch_on_merge` is a repository setting, see `CLAUDE.md`):

```bash
if [ "$(gh pr view <n> --json state --jq .state)" = MERGED ]; then
  git worktree remove <path-to-this-worktree>   # if this PR was driven from its own worktree
  git -C <main-checkout> fetch origin --prune
  git -C <main-checkout> branch -D <branch-name>
else
  echo "PR <n> is not MERGED; leaving the worktree and branch in place" >&2
fi
```

Everything destructive sits inside the one guard: nothing is removed until
GitHub says the merge happened. `-D`, not `-d`: a squash merge puts a new
commit on `develop`, so git never sees the branch as merged and `-d` refuses
every time. Forcing it is safe only because the guard has confirmed the PR
merged, and GitHub keeps the head at `refs/pull/<n>/head`, so nothing is lost.
On Windows, `git worktree remove` can fail with "Permission denied" while a
process still holds files in the worktree. Git has already unregistered it by
then, so delete the leftover directory once that process exits.

### 5. On hitting a ceiling: stop, comment, report

Whichever step's ceiling was hit (step 1's poll, step 3's rounds, or
`verify`'s own 3 attempts inside step 3):

```bash
cat > /tmp/drive-pr-stopped.md <<'MD'
drive-pr stopped: <which ceiling>, after <n> attempts/rounds.
<what was still failing>
<what is left to do>
MD
gh pr comment <n> --body-file /tmp/drive-pr-stopped.md
```

The quoted heredoc is the point: the failure text is CI output, and it must
reach the comment as text, not be expanded by the shell.

Then report the same thing back. This is the record SOP 1 asks for: what was
attempted, what failed, what is left — on the pull request, where the next
attempt (person or agent) starts from it instead of from zero.

---

## After a merge: check the next `smoke` run — ceiling: 30 polls × 30s

Once step 4 has merged, `smoke.yml` fires on the push to `develop`. Confirm
it, rather than assuming the merge was fine because `verify` was:

```bash
sha=$(gh pr view <n> --json mergeCommit --jq .mergeCommit.oid)
for attempt in $(seq 1 30); do
  # One call per attempt, filtered by gh's own --jq rather than a jq binary:
  # jq is not installed on every machine this runs on, and without it every
  # poll fails and the loop runs to its ceiling reporting nothing.
  # An unfinished run's conclusion is "", not null, and `//` only replaces
  # null: the empty field vanished and `read` shifted the run id into
  # $conclusion. Every field is non-empty, so `read` always splits in three.
  run=$(gh run list --workflow smoke --branch develop --commit "$sha" -L 1 \
          --json databaseId,status,conclusion \
          --jq '.[0] // {} | "\(.status // "not-registered") \(.conclusion | if . == null or . == "" then "-" else . end) \(.databaseId // "-")"')
  read -r status conclusion id <<< "$run"
  echo "attempt $attempt: status=$status conclusion=$conclusion run=$id"
  [ "$status" = "completed" ] && break
  sleep 30
done
```

- **Pinned to the merge commit.** `--commit "$sha"` selects the run for *this*
  merge. Without it, the first poll can land before GitHub registers the new
  run and read the previous merge's result as this one's. Until the run
  appears, `status` is `not-registered`, which counts as not settled.
- **Settled** means `status == "completed"`. Anything else after 30 attempts
  (60 → wait, 30 × 30s = 15 minutes, matched to the workflow's own timeout)
  is the ceiling: stop and report that `smoke` never finished, without
  guessing at a result it never produced.
- **On `conclusion != "success"`**, pull the failing step's log tail and open
  an issue from it — the record this project's `smoke`-after-merge row has no
  other mechanism for:

Rank the new issue before filing it. It is `medium` unless the log tail shows
something that contradicts `docs/data-governance.md`'s bounds (real data
reachable, authentication changed unexpectedly). That ranks `critical` per
SOP 5, adds `security`, and the issue body says why. Set the labels
explicitly, since the command does not decide for you:

```bash
labels=medium            # or: labels=critical,security  -- see above
# $id is the run the loop above settled on -- no second query.
gh run view "$id" --log-failed > /tmp/smoke-failure.log
gh issue create \
  --title "smoke failed after merging #<n>" \
  --body "$(printf '%s\n\n```\n%s\n```\n' \
    "Refs #<n>. Failing step's log tail:" \
    "$(tail -n 60 /tmp/smoke-failure.log)")" \
  --label "$labels"
```

This loop is deliberately separate from steps 1–5 above: it starts only
after a merge has actually happened, so a ceiling hit here never blocks or
un-merges anything — it only means the confirmation didn't complete, and
says so.
