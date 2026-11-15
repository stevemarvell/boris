// Tell "CI did not run" from "CI ran and failed", from the check runs alone.
//
// When a repository's Actions allowance is spent, GitHub refuses every job
// before a runner starts: each check run completes `failure` within seconds
// and has no log. Reading it as an ordinary red `verify` sends the driver
// hunting for a code defect that is not there. A real failure runs the
// toolchain, which takes longer than this. Only the check-run fields are
// used; fetching logs is not needed (drive-pr, "When CI does not run").

export const FAST_FAILURE_MS = 30_000;

/**
 * True when there is at least one check run, every one is completed with
 * conclusion `failure`, and each finished less than 30 seconds after it
 * started. A single success, a slow failure, an unfinished run or an
 * unreadable timestamp makes it false: that is an ordinary check result.
 * @param {Array<{status?: string, conclusion?: string | null, started_at?: string | null, completed_at?: string | null}> | null | undefined} checkRuns
 */
export function ciDidNotRun(checkRuns) {
  if (!Array.isArray(checkRuns) || checkRuns.length === 0) return false;
  return checkRuns.every((run) => {
    if (!run || run.status !== 'completed' || run.conclusion !== 'failure') return false;
    const ms = Date.parse(run.completed_at ?? '') - Date.parse(run.started_at ?? '');
    return Number.isFinite(ms) && ms >= 0 && ms < FAST_FAILURE_MS;
  });
}

// CLI: `gh api repos/{owner}/{repo}/commits/<sha>/check-runs --jq .check_runs \
//        | node scripts/ci-health.mjs` prints `true` or `false`.
if (import.meta.url === `file://${process.argv[1]}`) {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
  console.log(String(ciDidNotRun(JSON.parse(input))));
}
