// Find work that is stuck in a state nothing is watching.
//
// Both vsme-toolkit write-ups named this the largest gap: the loop drives
// known work well (verify, review, isolate, deploy, smoke, triage) and
// discovers none of it on its own. A branch nobody opened a pull request
// for, a worktree folder `git worktree` no longer tracks, a worktree
// registered for a branch whose pull request already merged, an open pull
// request that is conflicting or stale, one with no checks ever
// registered on its head — none of these show up in `verify`, and nothing
// else here looks for them. This script is that look, run first, before
// starting new work (`work-backlog`).
//
// It only reports. Nothing here deletes a branch, removes a worktree, or
// merges anything — a false positive here costs a wasted read, and a false
// deletion costs the thing itself.
//
// Exit 0 when nothing is stuck, 1 otherwise, so a shell or a skill can
// branch on it directly. `--json` prints the findings as data instead of
// text.
//
// Every gh, git and filesystem call goes through an injectable runner —
// the same pattern scripts/labels.mjs uses for `gh` — so the tests make no
// network calls and touch no real worktree.
import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './project.mjs';

/**
 * More than this many merges behind `develop` is reported. Not a retry
 * ceiling (docs/sops.md SOP 1's table), so not declared there — it is a
 * threshold, matching issue #212's own wording, "more than 2 merges
 * behind".
 */
export const MAX_MERGES_BEHIND = 2;

export const WORKTREES_DIR = join(ROOT, '.claude', 'worktrees');

const DEFAULT_LIMIT = 200;

const UNHEALTHY_MERGEABLE = new Set(['CONFLICTING', 'UNKNOWN']);

/** Runs `cmd` with `args`, resolving to its exit status, stdout and stderr. Never rejects. */
function exec(cmd) {
  return (args) =>
    new Promise((resolvePromise) => {
      execFile(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
        resolvePromise({ status: error?.code ?? 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
      });
    });
}

/** The default `gh` runner. */
export const gh = exec('gh');

/** The default `git` runner. */
export const git = exec('git');

/** What a failed call says went wrong: stderr, falling back to stdout when a tool left stderr empty. */
function reason({ stdout, stderr }) {
  return (stderr?.trim() || stdout?.trim() || '').trim();
}

/** Local branch names, from `git for-each-ref refs/heads`. */
export async function localBranches(run) {
  const result = await run(['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
  if (result.status !== 0) throw new Error(`git for-each-ref refs/heads failed: ${reason(result)}`);
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Remote branch names on `origin`, with the `origin/` prefix stripped and `origin/HEAD` excluded. */
export async function remoteBranches(run) {
  const result = await run(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin']);
  if (result.status !== 0) throw new Error(`git for-each-ref refs/remotes/origin failed: ${reason(result)}`);
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((ref) => ref.replace(/^origin\//, ''))
    .filter((name) => name !== 'HEAD');
}

/**
 * How many commits `ref` is ahead of `develop` (`git rev-list --count
 * develop..ref`). `null`, never a guess, when the ref cannot be resolved.
 */
export async function aheadCount(run, develop, ref) {
  const result = await run(['rev-list', '--count', `${develop}..${ref}`]);
  if (result.status !== 0) return null;
  const n = Number(result.stdout.trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * How many first-parent commits on `develop` are not reachable from `ref`.
 * This repository's pull requests land as squash merges, so the
 * first-parent chain on `develop` is one commit per merge — this is the
 * "merges behind" count, not a raw commit count. `null`, never a guess,
 * when either side cannot be resolved.
 */
export async function behindMergeCount(run, develop, ref) {
  const result = await run(['rev-list', '--count', '--first-parent', `${ref}..${develop}`]);
  if (result.status !== 0) return null;
  const n = Number(result.stdout.trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * Registered worktrees, from `git worktree list --porcelain`:
 * `[{ path, branch }]`. `branch` is `null` for a detached worktree.
 */
export function parseWorktreeList(porcelain) {
  const entries = [];
  let current = null;
  for (const line of String(porcelain ?? '').split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length).trim(), branch: null };
      entries.push(current);
    } else if (line.startsWith('branch ') && current) {
      current.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '');
    } else if (line.trim() === '') {
      current = null;
    }
  }
  return entries;
}

export async function worktreeList(run) {
  const result = await run(['worktree', 'list', '--porcelain']);
  if (result.status !== 0) throw new Error(`git worktree list failed: ${reason(result)}`);
  return parseWorktreeList(result.stdout);
}

/**
 * Every pull request, open or closed, with the fields every finding below
 * needs — one `gh pr list --state all` call rather than one per branch.
 */
export async function allPullRequests(run, limit = DEFAULT_LIMIT) {
  const result = await run([
    'pr',
    'list',
    '--state',
    'all',
    '--limit',
    String(limit),
    '--json',
    'number,title,state,headRefName,headRefOid,mergeable,statusCheckRollup',
  ]);
  if (result.status !== 0) throw new Error(`gh pr list failed: ${reason(result)}`);
  return JSON.parse(result.stdout);
}

/**
 * Branches ahead of `develop` with no pull request at all, open or closed —
 * (a) in the issue. `local` and `remote` are `[{ name, ahead }]`; a branch
 * present in both is reported once, naming where it was found.
 */
export function orphanedBranches({ local = [], remote = [] } = {}, prs = []) {
  const prHeads = new Set(prs.map((pr) => pr.headRefName));
  const byName = new Map();
  const add = (name, ahead, where) => {
    if (ahead == null || ahead <= 0 || prHeads.has(name)) return;
    const entry = byName.get(name) ?? { name, ahead, where: new Set() };
    entry.ahead = Math.max(entry.ahead, ahead);
    entry.where.add(where);
    byName.set(name, entry);
  };
  for (const { name, ahead } of local) add(name, ahead, 'local');
  for (const { name, ahead } of remote) add(name, ahead, 'remote');
  return [...byName.values()]
    .map((entry) => ({ name: entry.name, ahead: entry.ahead, where: [...entry.where].sort().join(' and ') }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Folder names directly under `.claude/worktrees/` that `git worktree list`
 * does not register — (b) in the issue, the "orphaned folder" half.
 */
export function untrackedWorktreeFolders(diskNames, registeredPaths) {
  const registered = new Set(registeredPaths.map((path) => path.replace(/\\/g, '/').split('/').filter(Boolean).pop()));
  return diskNames.filter((name) => !registered.has(name));
}

/**
 * Registered worktrees whose branch's pull request has already merged —
 * (b) in the issue, the "stale registration" half.
 */
export function mergedWorktrees(worktrees, prs) {
  const mergedByHead = new Map(prs.filter((pr) => pr.state === 'MERGED').map((pr) => [pr.headRefName, pr]));
  return (worktrees ?? [])
    .filter((worktree) => worktree.branch && mergedByHead.has(worktree.branch))
    .map((worktree) => ({ path: worktree.path, branch: worktree.branch, pr: mergedByHead.get(worktree.branch).number }));
}

/**
 * Open pull requests whose `mergeable` is bad, or that are more than
 * `MAX_MERGES_BEHIND` merges behind `develop` — (c) in the issue. `behind`
 * is a `Map<number, number|null>` from an external git call; a PR missing
 * from it, or mapped to `null`, is not reported for that reason — unknown
 * is not the same as clean, and is not guessed at.
 */
export function staleOrConflicting(prs, behind = new Map()) {
  return (prs ?? [])
    .filter((pr) => pr.state === 'OPEN')
    .map((pr) => {
      const reasons = [];
      if (UNHEALTHY_MERGEABLE.has(pr.mergeable)) reasons.push(`mergeable is ${pr.mergeable}`);
      const behindCount = behind.get(pr.number);
      if (typeof behindCount === 'number' && behindCount > MAX_MERGES_BEHIND) {
        reasons.push(`${behindCount} merges behind develop`);
      }
      return { number: pr.number, title: pr.title, reasons };
    })
    .filter((pr) => pr.reasons.length > 0);
}

/** Open pull requests with no checks registered on their head commit at all — (d) in the issue. */
export function noChecksRegistered(prs) {
  return (prs ?? []).filter((pr) => pr.state === 'OPEN' && (!pr.statusCheckRollup || pr.statusCheckRollup.length === 0));
}

/** Whether `findings` (the shape `find` returns) has nothing to report. */
export function isEmpty(findings) {
  return (
    findings.orphanedBranches.length === 0 &&
    findings.untrackedWorktrees.length === 0 &&
    findings.mergedWorktrees.length === 0 &&
    findings.staleOrConflicting.length === 0 &&
    findings.noChecksRegistered.length === 0
  );
}

/** The default check for uncommitted changes in a folder `git worktree list` no longer tracks. */
async function defaultGitStatus(dir) {
  const result = await git(['-C', dir, 'status', '--porcelain']);
  if (result.status !== 0) return null; // not a git directory any more, or another error — unknown, not "empty"
  return result.stdout.trim().length > 0;
}

/** The default directory listing: `[]` for a directory that does not exist, never a thrown error. */
function defaultReadDir(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir);
}

/**
 * Everything stuck, gathered via the injected `gh`/`git`/filesystem
 * functions. Every parameter defaults to the real thing; tests override
 * all of them and make no network calls.
 */
export async function find({
  gh: ghRun = gh,
  git: gitRun = git,
  develop = 'origin/develop',
  worktreesDir,
  readDir = defaultReadDir,
  gitStatus = defaultGitStatus,
} = {}) {
  const [local, remoteNames, worktrees, prs] = await Promise.all([
    localBranches(gitRun),
    remoteBranches(gitRun),
    worktreeList(gitRun),
    allPullRequests(ghRun),
  ]);

  const localWithAhead = await Promise.all(
    local.map(async (name) => ({ name, ahead: await aheadCount(gitRun, develop, name) })),
  );
  const remoteWithAhead = await Promise.all(
    remoteNames.map(async (name) => ({ name, ahead: await aheadCount(gitRun, develop, `origin/${name}`) })),
  );
  const orphaned = orphanedBranches({ local: localWithAhead, remote: remoteWithAhead }, prs);

  // `.claude/worktrees/` lives under the *main* working tree, not under
  // whichever checkout happens to be running this script — an agent
  // normally runs it from inside one of the very sibling worktrees it is
  // meant to see. `git worktree list` always lists the main working tree
  // first, so that is where the directory actually is, regardless of
  // where this process's own files sit. `WORKTREES_DIR` (ROOT-relative) is
  // only the fallback for the degenerate case of no worktree data at all.
  const mainRoot = worktrees[0]?.path ?? ROOT;
  const dir = worktreesDir ?? join(mainRoot, '.claude', 'worktrees');
  const registeredPaths = worktrees.map((worktree) => worktree.path);
  const diskNames = readDir(dir);
  const untrackedNames = untrackedWorktreeFolders(diskNames, registeredPaths);
  const untracked = [];
  for (const name of untrackedNames) {
    const folder = join(dir, name);
    const entryCount = readDir(folder).length;
    const hasChanges = await gitStatus(folder);
    untracked.push({ name, entryCount, hasChanges: hasChanges === true });
  }

  const merged = mergedWorktrees(worktrees, prs);

  const openPrs = prs.filter((pr) => pr.state === 'OPEN');
  const behind = new Map(
    await Promise.all(
      openPrs.map(async (pr) => [pr.number, pr.headRefOid ? await behindMergeCount(gitRun, develop, pr.headRefOid) : null]),
    ),
  );
  const stale = staleOrConflicting(prs, behind);
  const noChecks = noChecksRegistered(prs);

  return {
    orphanedBranches: orphaned,
    untrackedWorktrees: untracked,
    mergedWorktrees: merged,
    staleOrConflicting: stale,
    noChecksRegistered: noChecks,
  };
}

/** Every finding as one line, naming a suggested next action. */
export function renderFindings(findings) {
  const lines = [];
  for (const b of findings.orphanedBranches) {
    lines.push(
      `orphaned branch: '${b.name}' (${b.where}) is ${b.ahead} commit${b.ahead === 1 ? '' : 's'} ahead of develop with no pull request, open or closed — open one, or delete the branch if the work is abandoned.`,
    );
  }
  for (const w of findings.untrackedWorktrees) {
    const changes = w.hasChanges ? 'with uncommitted changes' : 'no uncommitted changes';
    lines.push(
      `untracked worktree folder: '.claude/worktrees/${w.name}' is not in \`git worktree list\` (${w.entryCount} entr${w.entryCount === 1 ? 'y' : 'ies'}, ${changes}) — inspect it, then remove the folder by hand.`,
    );
  }
  for (const w of findings.mergedWorktrees) {
    lines.push(
      `stale worktree: '${w.path}' is registered for branch '${w.branch}', whose pull request #${w.pr} already merged — run \`git worktree remove\`, then delete the branch.`,
    );
  }
  for (const pr of findings.staleOrConflicting) {
    lines.push(
      `pull request #${pr.number} "${pr.title}": ${pr.reasons.join(', ')} — merge develop into the branch (force-push is denied).`,
    );
  }
  for (const pr of findings.noChecksRegistered) {
    lines.push(
      `pull request #${pr.number} "${pr.title}": no checks have registered on its head commit — check \`mergeStateStatus\` first; if it is behind or conflicting, merge develop in, otherwise push again to retrigger.`,
    );
  }
  return lines;
}

/** `findings`, rendered for a person: one line per finding, or a clean report. */
export function render(findings) {
  const lines = renderFindings(findings);
  return lines.length ? lines.join('\n') + '\n' : 'nothing stuck: no orphaned branches, worktrees, or problem pull requests.\n';
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  // Best-effort freshness. Updating `origin/develop` rather than the local
  // `develop` branch: a local branch shares one ref store across every
  // worktree, and git refuses to move one checked out in another worktree —
  // the remote-tracking ref carries no such restriction. A failed fetch
  // (offline, no credentials) is reported nowhere and does not stop the
  // run; the comparison just falls back to whatever `origin/develop`
  // already points at.
  await git(['fetch', 'origin', 'develop']);

  const findings = await find();
  const ok = isEmpty(findings);
  process.stdout.write(process.argv.includes('--json') ? `${JSON.stringify({ ok, findings }, null, 2)}\n` : render(findings));
  process.exit(ok ? 0 : 1);
}
