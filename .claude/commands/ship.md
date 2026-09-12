---
description: Verify, commit, and open a pull request for the current work.
---

Ship the current working-tree changes:

1. Run `npm run verify`. If it fails, stop and fix it — do not continue.
2. Branch off `develop` if not already on a feature branch.
3. Commit. The subject is imperative and under 72 characters; the body says
   *why* the change exists, not what it does.
4. Push and open a PR against `develop` with `gh pr create`.
5. Report the PR URL. Merge once CI is green; stop and ask for anything
   destructive, outward-facing, or beyond what was asked.

$ARGUMENTS
