// Delete Vercel preview deployments nobody can need any more.
//
// Vercel never tears a preview down: the deployment and its
// `-git-<branch>-` alias outlive the merge and the branch (the `deployment`
// skill has the measurement), and Deployment Retention is not on this plan.
// .github/workflows/preview-prune.yml runs this with VERCEL_TOKEN, a token
// scoped to the one team:
//
//     node scripts/vercel-prune.mjs branch <name>      # a pull request closed
//     node scripts/vercel-prune.mjs stale <live-branches-file> [--dry-run]
//
// `branch` deletes that branch's previews. `stale` deletes every preview whose
// branch is not in the file — the branches that still exist on origin — which
// is how the backlog from before this existed gets cleared.
//
// What is never deleted, whatever the arguments say: a production deployment,
// or anything built from `develop`. Those are checked per deployment, not
// trusted to the query, so a filter Vercel ignores cannot widen the delete.
//
// A closed pull request's preview is rebuildable from its commit — GitHub
// keeps every pull request's head at refs/pull/<n>/head — so `branch` loses
// nothing that cannot be had back, which is what makes it safe to run
// unattended (`docs/sops.md` SOP 6: recoverability, not scope). `stale` has no
// such guarantee: a branch pushed and deleted without a pull request leaves a
// commit nothing keeps. So `stale` is only ever started by hand, and the
// workflow defaults it to --dry-run.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deployed, loadProject } from './project.mjs';

// Which team and projects, from project.json (#173): every app that names a
// vercelProject.
const PROJECT = loadProject();
export const TEAM = PROJECT.vercel.team;
export const PROJECTS = deployed(PROJECT).map(([, app]) => app.vercelProject);
export const PRODUCTION_BRANCH = 'develop';
// 100 deployments a page; 20 pages is 2,000 per project, twenty times the
// whole backlog this was written to clear. Hitting it is reported, not retried.
export const MAX_PAGES = 20;

const API = 'https://api.vercel.com';

/** Whether a deployment may be deleted at all, before any branch rule. */
export function isPreview(deployment) {
  const ref = deployment.meta?.githubCommitRef;
  return deployment.target !== 'production' && Boolean(ref) && ref !== PRODUCTION_BRANCH;
}

/** The deployments to delete, given what should be kept. */
export function select(deployments, rule) {
  return deployments.filter((d) => {
    if (!isPreview(d)) return false;
    const ref = d.meta.githubCommitRef;
    return rule.branch !== undefined ? ref === rule.branch : !rule.live.has(ref);
  });
}

/** Every deployment of `project`, optionally for one branch. Throws on ceiling. */
export async function listDeployments(fetchJson, project, branch) {
  const all = [];
  let until;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const query = new URLSearchParams({ projectId: project, slug: TEAM, limit: '100' });
    if (branch) query.set('branch', branch);
    if (until) query.set('until', String(until));
    const body = await fetchJson(`${API}/v6/deployments?${query}`);
    all.push(...body.deployments);
    until = body.pagination?.next;
    if (!until) return all;
  }
  throw new Error(`${project}: more than ${MAX_PAGES} pages of deployments; stopped rather than guess`);
}

/** Delete what `rule` selects across both projects. Returns what it did. */
export async function prune({ fetchJson, remove, rule, dryRun = false, log = console.log }) {
  const deleted = [];
  for (const project of PROJECTS) {
    const deployments = await listDeployments(fetchJson, project, rule.branch);
    for (const d of select(deployments, rule)) {
      const id = d.uid ?? d.id;
      log(`${dryRun ? 'would delete' : 'deleting'} ${project} ${id} (${d.meta.githubCommitRef})`);
      if (!dryRun) await remove(id);
      deleted.push({ project, id, branch: d.meta.githubCommitRef });
    }
  }
  return deleted;
}

function vercel(token) {
  const call = async (method, url) => {
    const response = await fetch(url, { method, headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`${method} ${url.split('?')[0]}: ${response.status} ${await response.text()}`);
    return response.json();
  };
  return {
    fetchJson: (url) => call('GET', url),
    remove: (id) => call('DELETE', `${API}/v13/deployments/${encodeURIComponent(id)}?slug=${TEAM}`),
  };
}

export async function main(argv, env) {
  const token = env.VERCEL_TOKEN;
  if (!token) throw new Error('VERCEL_TOKEN is not set');
  const [mode, arg, flag] = argv;
  let rule;
  if (mode === 'branch' && arg) {
    rule = { branch: arg };
  } else if (mode === 'stale' && arg) {
    const live = new Set(readFileSync(arg, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean));
    // An empty list would mean "every branch is gone" and delete every preview.
    if (live.size === 0) throw new Error(`${arg} lists no live branches; refusing to treat every preview as stale`);
    rule = { live };
  } else {
    throw new Error('usage: vercel-prune.mjs branch <name> | stale <live-branches-file> [--dry-run]');
  }
  const deleted = await prune({ ...vercel(token), rule, dryRun: flag === '--dry-run' });
  console.log(`${flag === '--dry-run' ? 'would delete' : 'deleted'} ${deleted.length} preview deployment(s)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2), process.env).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
