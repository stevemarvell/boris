// The AI layer's only view of the application (#173).
//
// Everything under .claude/, scripts/ and .github/ that needs to know what
// the application is — where its apps live, what toolchain each uses, what a
// build reads, which Vercel project deploys it, where it answers and how to
// smoke-test it — asks
// this module, which reads project.json at the repository root. Swapping the
// family tree for another application means editing apps/ and project.json;
// nothing here names an app.
//
// The manifest is validated on load, so a typo fails the first hook or script
// that reads it, loudly, rather than turning into a build that silently never
// happens. A field is added when something reads it, not before (#174's review).
//
// CLI, for workflows and shells:
//
//     node scripts/project.mjs apps [toolchain]   # app paths, one per line
import { readFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const MANIFEST = join(ROOT, 'project.json');

// The AI layer's own code, which `verify` tests and the stop hook therefore
// watches. Declared here rather than in the manifest: it is this layer's
// footprint, not the application's.
export const HARNESS_CODE = ['scripts', '.claude/hooks', '.claude/statusline.mjs', 'project.json'];

const TOOLCHAINS = new Set(['python', 'node']);

/**
 * Whether `child` is strictly inside `parent`, both repository-relative. A
 * string prefix is not enough — `apps/api/../../etc/x` starts with
 * `apps/api/` (#177's review) — so both are normalised and `child` must be
 * spelled in normal form, with no `..` left once it is.
 */
export function inside(parent, child) {
  if (typeof child !== 'string' || posix.isAbsolute(child) || posix.normalize(child) !== child) return false;
  const rel = posix.relative(posix.normalize(parent), child);
  return rel !== '' && !rel.startsWith('..') && !posix.isAbsolute(rel);
}

/** A repository-relative path in normal form that does not climb out of the repository. */
function isContainedPath(path) {
  return typeof path === 'string' && path !== '' && inside('.', path);
}

/** Throws, naming the field, unless `project` has the shape project.json documents. */
export function validate(project) {
  const fail = (what) => {
    throw new Error(`project.json: ${what}`);
  };
  if (!project || typeof project !== 'object') fail('is not an object');
  if (typeof project.name !== 'string' || !project.name) fail('"name" must be a non-empty string');
  if (typeof project.vercel?.team !== 'string') fail('"vercel.team" must be a string');
  const apps = Object.entries(project.apps ?? {});
  if (apps.length === 0) fail('"apps" must declare at least one app');
  for (const [name, app] of apps) {
    const at = `apps.${name}`;
    if (!isContainedPath(app.path)) fail(`${at}.path must be a relative path inside the repository`);
    if (!TOOLCHAINS.has(app.toolchain)) fail(`${at}.toolchain must be one of ${[...TOOLCHAINS].join(', ')}`);
    if (!Array.isArray(app.reads) || app.reads.length === 0) fail(`${at}.reads must list at least one path`);
    if (app.ignores !== undefined && !Array.isArray(app.ignores)) fail(`${at}.ignores must be a list`);
    if (app.verify !== undefined && !(Array.isArray(app.verify) && app.verify.every((c) => typeof c === 'string' && c.trim()))) {
      fail(`${at}.verify must be a list of commands`);
    }
    if (app.vercelProject !== undefined && (typeof app.vercelProject !== 'string' || !app.vercelProject)) {
      fail(`${at}.vercelProject must be a non-empty string`);
    }
    // A deployed app must say where it answers and which endpoint reports the
    // commit it was built from: smoke's freshness gate (#50) is what tells a
    // deployment that happened from one that silently did not.
    if (app.vercelProject !== undefined) {
      if (typeof app.url !== 'string' || !/^https:\/\/[^/]+$/.test(app.url)) fail(`${at}.url must be an https origin with no path`);
      if (typeof app.commitEndpoint !== 'string' || !app.commitEndpoint.startsWith('/')) {
        fail(`${at}.commitEndpoint must be a path starting with /`);
      }
    } else if (app.url !== undefined || app.commitEndpoint !== undefined) {
      fail(`${at} sets url or commitEndpoint without a vercelProject`);
    }
    if (app.smoke !== undefined && !inside(app.path, app.smoke)) {
      fail(`${at}.smoke must be a script inside ${app.path}`);
    }
  }
  return project;
}

export function loadProject(path = MANIFEST) {
  return validate(JSON.parse(readFileSync(path, 'utf8')));
}

/** The apps, as [name, app] pairs, optionally only one toolchain's. */
export function apps(project, toolchain) {
  return Object.entries(project.apps).filter(([, app]) => !toolchain || app.toolchain === toolchain);
}

/** The apps Vercel deploys: those that name a vercelProject. */
export function deployed(project) {
  return apps(project).filter(([, app]) => app.vercelProject);
}

/** The app whose directory holds `relativePath`, or null. The deepest path wins. */
export function appFor(project, relativePath) {
  const path = relativePath.replace(/\\/g, '/');
  let best = null;
  for (const [name, app] of apps(project)) {
    if ((path === app.path || path.startsWith(`${app.path}/`)) && (!best || app.path.length > best[1].path.length)) {
      best = [name, app];
    }
  }
  return best;
}

/**
 * Git pathspecs for what a build of `name` reads. The manifest, this module
 * and the ignore script are always included: a change to any of them can
 * change what a build decides, so it rebuilds everything rather than guess.
 */
export function buildPathspecs(project, name) {
  const app = project.apps[name];
  if (!app) return null;
  return [
    ...app.reads,
    'project.json',
    'scripts/project.mjs',
    'scripts/vercel-ignore.mjs',
    ...(app.ignores ?? []).map((path) => (path.includes('*') ? `:(exclude,glob)${path}` : `:(exclude)${path}`)),
  ];
}

/** Every path `verify` covers: each app's inputs and the AI layer's own code. */
export function verifiedPaths(project) {
  const paths = new Set(HARNESS_CODE);
  for (const [, app] of apps(project)) {
    paths.add(app.path);
    for (const read of app.reads) paths.add(read);
  }
  return [...paths];
}

/** The CLI's answer as lines. Only subcommands something calls are here. */
export function cli([command, ...args], project = loadProject()) {
  if (command === 'apps') return apps(project, args[0]).map(([, app]) => app.path);
  throw new Error('usage: project.mjs apps [toolchain]');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.stdout.write(cli(process.argv.slice(2)).join('\n') + '\n');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
