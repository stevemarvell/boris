// Post-deploy smoke, for whatever project.json says is deployed (#173).
//
// smoke.yml used to be a list of this application's checks with both
// hostnames written into it. The AI layer now owns only the part that is the
// same for every app, and each app owns the rest:
//
// 1. The freshness gate — the one check that tells a *current* deployment
//    from a stale one. Issue #50 is why it exists: on Railway, a commit
//    touching only data/ once fell outside the watch list and silently
//    deployed nothing, while every other check passed, because each asked
//    whether the deployed API was correct and none asked whether it was
//    *this* one. Each deployed app reports the commit it was built from at
//    its `commitEndpoint` (VERCEL_GIT_COMMIT_SHA). The gate accepts this
//    commit, or an older one whose build inputs are identical — which is what
//    a build skipped by scripts/vercel-ignore.mjs leaves behind — asked of
//    git with the same pathspecs the ignore step uses, so the two cannot
//    disagree. A skipped build passes at once; a build that should have
//    happened still has to show up.
// 2. The app's own checks, in the script its `smoke` field names, with every
//    deployed app's URL in the environment under its name upper-cased
//    ($API, $WEB), since one app's checks can need another's origin (CORS).
//
// Apps run in project.json order, each gate before its checks, and the first
// failure stops the run. Ceiling: GATE_ATTEMPTS × GATE_INTERVAL_MS per app,
// declared in docs/sops.md.
//
// Usage (smoke.yml runs it with a full-history checkout, fetch-depth: 0):
//     node scripts/smoke.mjs            # the commit is $GITHUB_SHA
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT, buildPathspecs, deployed, loadProject } from './project.mjs';

export const GATE_ATTEMPTS = 40;
export const GATE_INTERVAL_MS = 15_000;

/** Every deployed app's URL, keyed by its name upper-cased: { API: ..., WEB: ... }. */
export function appUrls(project) {
  return Object.fromEntries(deployed(project).map(([name, app]) => [name.toUpperCase().replace(/[^A-Z0-9]/g, '_'), app.url]));
}

async function reportedCommit(fetchJson, url) {
  try {
    const body = await fetchJson(url);
    return typeof body?.commit === 'string' ? body.commit : '';
  } catch {
    return ''; // A cold start or a stale route: not an answer yet, go round again.
  }
}

/** Wait until the app reports `sha`, or a commit with identical build inputs. */
export async function waitForCommit({ project, name, sha, fetchJson, git, sleep, log, attempts = GATE_ATTEMPTS }) {
  const app = project.apps[name];
  const pathspecs = buildPathspecs(project, name);
  const endpoint = `${app.url}${app.commitEndpoint}`;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const deployedSha = await reportedCommit(fetchJson, endpoint);
    log(`${name} attempt ${attempt}: deployed=${deployedSha || '<none>'}`);
    if (deployedSha === sha) return { ok: true, reason: `${name} is serving this commit` };
    if (deployedSha && git(['diff', '--quiet', deployedSha, sha, '--', ...pathspecs]).status === 0) {
      return { ok: true, reason: `${name} is serving ${deployedSha}, whose inputs match this commit; its build was skipped` };
    }
    if (attempt < attempts) await sleep(GATE_INTERVAL_MS);
  }
  return { ok: false, reason: `${name} never reported ${sha} after ${attempts} attempts; it is serving an older build` };
}

/** Gate and check every deployed app. Stops at the first failure. */
export async function smoke({ project, sha, fetchJson, git, sleep, run, log }) {
  if (!sha) return { ok: false, reason: 'no commit to check: GITHUB_SHA is not set' };
  const urls = appUrls(project);
  for (const [name, app] of deployed(project)) {
    log(`::group::${name}: freshness gate`);
    const gate = await waitForCommit({ project, name, sha, fetchJson, git, sleep, log });
    log(gate.reason);
    log('::endgroup::');
    if (!gate.ok) return gate;
    if (app.smoke) {
      const status = run(app.smoke, urls);
      if (status !== 0) return { ok: false, reason: `${name}: ${app.smoke} failed (exit ${status})` };
    }
  }
  return { ok: true, reason: 'every deployed app is current and passed its checks' };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = await smoke({
    project: loadProject(),
    sha: process.env.GITHUB_SHA,
    fetchJson: async (url) => {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`${response.status}`);
      return response.json();
    },
    git: (args) => {
      const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
      return { status: result.status ?? -1 };
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    run: (script, urls) =>
      spawnSync('bash', [script], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...urls } }).status ?? -1,
    log: (line) => console.log(line),
  });
  console.log(result.reason);
  process.exit(result.ok ? 0 : 1);
}
