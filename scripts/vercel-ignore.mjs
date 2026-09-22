// Vercel's Ignored Build Step: skip a build when nothing it reads has changed.
//
// Both Vercel projects rebuilt on every push to every branch, whatever the
// push touched — 100 deployments in the 30 hours before this existed, most of
// them for pull requests that changed only .claude/ or .github/. Each
// project's vercel.json runs this as its `ignoreCommand`:
//
//     node ../../scripts/vercel-ignore.mjs api|web
//
// Vercel reads the exit code backwards from what you would guess: 0 means
// *skip* the build, anything else means build. Every path through here that
// cannot prove "nothing changed" builds — a missing base commit, a failed
// fetch, a git error, even node itself failing to start. The cost of being
// wrong that way is one redundant build; the cost of being wrong the other
// way is a deployment that silently never happened, which is #50.
//
// The base is VERCEL_GIT_PREVIOUS_SHA — the last *successful* deployment of
// this project on this branch — so a skipped build never becomes a base, and
// the next build diffs against the last one that actually shipped. A branch's
// first push has none; that compares against where it left develop instead
// (`forkPoint`).
//
// smoke.yml asks the same question after a merge (`paths api`), so a skipped
// API build is not mistaken for a stale one.
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// What each build reads, as git pathspecs from the repository root.
//
// The API's Root Directory is apps/api and it bundles data/ and manual/ from
// inside it (#126), so nothing outside that directory reaches its build.
//
// The web build reaches all over the repository — docs/, manual/web/,
// index.html, scripts/, the root lockfile — so it is listed by what it does
// *not* read. A new top-level directory therefore rebuilds the web app until
// somebody adds it here: the safe direction to be wrong in.
export const PATHSPECS = {
  api: ['apps/api', 'scripts/vercel-ignore.mjs'],
  web: [
    '.',
    ':(exclude)apps/api',
    ':(exclude)apps/mcp',
    ':(exclude).claude',
    ':(exclude).github',
    ':(exclude)design',
    ':(exclude)telemetry',
    ':(exclude)CLAUDE.md',
    // Tests are checked by `verify`, not shipped in the bundle.
    ':(exclude)apps/web/e2e',
    ':(exclude,glob)**/*.test.ts',
    ':(exclude,glob)**/*.test.tsx',
    // Scripts only CI and local tooling run. The build's own — write-api-url,
    // build-docs and what they import — stay in, as does anything new.
    ...['assert-review-ran', 'bootstrap', 'lsp', 'paths', 'ports', 'pr-contention', 'review-scope', 'test-census']
      .map((name) => `:(exclude,glob)scripts/${name}.*`),
    ':(exclude,glob)scripts/write-ci-*',
  ],
};

// Decide whether to build. `git` runs a git command in the repository root and
// returns { status, stdout }. Returns { build, reason }.
export function decide(project, env, git) {
  const pathspecs = PATHSPECS[project];
  if (!pathspecs) return { build: true, reason: `unknown project "${project}"` };

  let base = env.VERCEL_GIT_PREVIOUS_SHA;
  if (base) {
    // Vercel's clone is shallow; the last deployed commit may be outside it.
    if (!hasCommit(git, base) && git(['fetch', '--no-tags', '--depth=1', 'origin', base]).status !== 0) {
      return { build: true, reason: `cannot fetch the previous deployment's commit ${base}` };
    }
  } else {
    base = forkPoint(git);
    if (!base) return { build: true, reason: 'no previous deployment, and no merged pull request in the clone' };
  }

  const diff = git(['diff', '--quiet', base, 'HEAD', '--', ...pathspecs]);
  if (diff.status === 0) return { build: false, reason: `nothing ${project} reads changed since ${base}` };
  if (diff.status === 1) return { build: true, reason: `${project} changed since ${base}` };
  return { build: true, reason: `git diff failed against ${base}` };
}

// Where a branch left develop, found without develop. Vercel's clone has no
// credentials to fetch it — measured on #168's own first build — but it does
// hold the branch's last few ancestors, and develop's commits are recognisable:
// squash merges, committed by GitHub, with one parent and a "(#123)" subject.
// A branch's own commits are committed locally, and GitHub's "update branch"
// merges have two parents, so neither is mistaken for one. The nearest such
// ancestor is the fork point, or near enough that the diff only over-counts.
export function forkPoint(git) {
  const log = git(['log', '-n', '50', '--format=%H%x09%P%x09%ce%x09%s', 'HEAD']);
  if (log.status !== 0) return null;
  for (const line of log.stdout.split('\n')) {
    const [sha, parents, committer, subject] = line.split('\t');
    if (!sha || parents === undefined || subject === undefined) continue;
    if (committer === 'noreply@github.com' && parents.split(' ').length === 1 && /\(#\d+\)$/.test(subject)) {
      return sha;
    }
  }
  return null;
}

function hasCommit(git, sha) {
  return git(['cat-file', '-e', `${sha}^{commit}`]).status === 0;
}

function runGit(args) {
  const result = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  return { status: result.status ?? -1, stdout: result.stdout ?? '' };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [command, project] = process.argv.slice(2);
  if (command === 'paths') {
    // For smoke.yml: the pathspecs, one per line.
    const pathspecs = PATHSPECS[project];
    if (!pathspecs) process.exit(2);
    process.stdout.write(pathspecs.join('\n') + '\n');
  } else {
    const { build, reason } = decide(command, process.env, runGit);
    console.log(`vercel-ignore: ${build ? 'building' : 'skipping'} — ${reason}`);
    process.exit(build ? 1 : 0);
  }
}
