// The AI layer's only view of the application (#173).
//
// Everything under .claude/, scripts/ and .github/ that needs to know what
// the application is — where its apps live, what toolchain each uses, what a
// build reads, which Vercel project deploys it and where it answers — asks
// this module, which reads project.json at the repository root. Swapping the
// family tree for another application means editing apps/ and project.json;
// nothing here names an app.
//
// The manifest is validated on load, so a typo fails the first hook or script
// that reads it, loudly, rather than turning into a build that silently never
// happens.
//
// CLI, for workflows and shells:
//
//     node scripts/project.mjs apps [toolchain]   # app paths, one per line
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const MANIFEST = join(ROOT, 'project.json');

// The AI layer's own code, which `verify` tests and the stop hook therefore
// watches. Declared here rather than in the manifest: it is this layer's
// footprint, not the application's.
export const HARNESS_CODE = ['scripts', '.claude/hooks', '.claude/statusline.mjs', 'project.json'];

const TOOLCHAINS = new Set(['python', 'node']);

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
    if (typeof app.path !== 'string' || !app.path || app.path.startsWith('/')) fail(`${at}.path must be a relative path`);
    if (!TOOLCHAINS.has(app.toolchain)) fail(`${at}.toolchain must be one of ${[...TOOLCHAINS].join(', ')}`);
    if (!Array.isArray(app.reads) || app.reads.length === 0) fail(`${at}.reads must list at least one path`);
    if (app.ignores !== undefined && !Array.isArray(app.ignores)) fail(`${at}.ignores must be a list`);
    const deployed = ['vercelProject', 'url', 'commitEndpoint'].filter((k) => app[k] !== undefined);
    if (deployed.length && deployed.length !== 3) fail(`${at} must set vercelProject, url and commitEndpoint together, or none`);
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
