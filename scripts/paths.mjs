// One spelling of a path, for every comparison in this repository.
//
// This lived in review-scope.mjs, where #108 put it: the defect in #101 was
// one comparison lowercasing and the next one not, so
// `.CLAUDE/agents/security-checker.md` skipped both of its own reviews. That
// commit gave the review scope rule a single normalisation and a test that
// asserts the helper directly, so a future comparison cannot grow its own.
//
// test-census.mjs then needed the same thing and began by re-deriving a
// strictly weaker copy — trim and strip `./`, but no case fold — which is the
// first step of exactly the drift #108 closed. So it moved here, and both
// import it. review-scope.mjs re-exports it, because its public surface and
// the test that guards it are part of what #108 bought.

/**
 * Trim, drop a leading `./`, and fold case.
 *
 * Case folding happens here and nowhere else, which is the point.
 */
export function canonical(path) {
  return String(path).trim().replace(/^\.\//, '').toLowerCase();
}
