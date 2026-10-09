// Labels as data, not something each repository re-creates by hand.
//
// Every repository built from boris ended up with its own slightly different
// idea of what `critical` or `aia1` means, because the only copy of a label's
// colour and description lived in whichever repository's settings UI someone
// typed it into last. `labels.json` at the repository root is now the single
// source of truth; this script makes a repository's live labels match it.
//
// CLI:
//
//     node scripts/labels.mjs [--repo owner/name] [--dry-run]
//
// Without `--repo`, `gh` resolves the repository from the current directory
// the way every other `gh` invocation here does. `--dry-run` prints what
// would change without calling `gh label create`.
//
// This never deletes a label. A name in a repository's label set that is not
// in the manifest is left alone — removing it is a judgement call about that
// repository's own issues and pull requests, not something synced data
// should do unattended.
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MANIFEST = join(dirname(dirname(fileURLToPath(import.meta.url))), 'labels.json');

const COLOR = /^[0-9a-f]{6}$/i;

/** Throws, naming the problem, unless `manifest` is the shape `labels.json` documents. */
export function validate(manifest) {
  const fail = (what) => {
    throw new Error(`labels.json: ${what}`);
  };
  if (!Array.isArray(manifest) || manifest.length === 0) fail('must be a non-empty array');
  const seen = new Set();
  for (const [i, label] of manifest.entries()) {
    const at = `[${i}]`;
    if (!label || typeof label !== 'object') fail(`${at} must be an object`);
    if (typeof label.name !== 'string' || !label.name) fail(`${at}.name must be a non-empty string`);
    if (seen.has(label.name)) fail(`"${label.name}" is listed more than once`);
    seen.add(label.name);
    if (typeof label.color !== 'string' || !COLOR.test(label.color)) fail(`"${label.name}".color must be a 6-digit hex string`);
    if (typeof label.description !== 'string') fail(`"${label.name}".description must be a string`);
  }
  return manifest;
}

/** The manifest, read from disk and validated. */
export function loadManifest(path = MANIFEST) {
  return validate(JSON.parse(readFileSync(path, 'utf8')));
}

/**
 * The labels to create or update, given the manifest and a repository's
 * existing labels (`gh label list --json name,color,description`).
 *
 * A label absent from `existing` is a create. One present with a different
 * colour or description is an update. One already matching is left out —
 * `plan` never reports a label as changing when nothing would. Never returns
 * anything for a name that is in `existing` but not in the manifest: this
 * never deletes.
 */
export function plan(manifest, existing) {
  const current = new Map(existing.map((label) => [label.name, label]));
  const actions = [];
  for (const label of manifest) {
    const have = current.get(label.name);
    if (!have) {
      actions.push({ ...label, action: 'create' });
    } else if (have.color.toLowerCase() !== label.color.toLowerCase() || (have.description ?? '') !== label.description) {
      actions.push({ ...label, action: 'update' });
    }
  }
  return actions;
}

/** Runs `gh` with `args`, resolving to its exit status and stdout. Never rejects. */
export function gh(args) {
  return new Promise((resolve) => {
    execFile('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      resolve({ status: error?.code ?? 0, stdout: String(stdout ?? '') });
    });
  });
}

/** The live labels of a repository, via `gh label list`. `repo` is omitted when undefined. */
export async function listLabels(run, repo) {
  const args = ['label', 'list', '--json', 'name,color,description', '--limit', '200'];
  if (repo) args.push('--repo', repo);
  const { status, stdout } = await run(args);
  if (status !== 0) throw new Error(`gh label list failed: ${stdout.trim()}`);
  return JSON.parse(stdout);
}

/**
 * Bring a repository's labels to match the manifest. Returns the plan it
 * applied (or would apply, under `dryRun`).
 */
export async function apply({ run = gh, manifest, repo, dryRun = false, log = console.log }) {
  const existing = await listLabels(run, repo);
  const actions = plan(manifest, existing);
  for (const label of actions) {
    log(`${dryRun ? 'would ' : ''}${label.action} ${label.name} (#${label.color})`);
    if (dryRun) continue;
    const args = ['label', 'create', label.name, '--color', label.color, '--description', label.description, '--force'];
    if (repo) args.push('--repo', repo);
    const { status, stdout } = await run(args);
    if (status !== 0) throw new Error(`gh label create ${label.name} failed: ${stdout.trim()}`);
  }
  if (actions.length === 0) log('every label already matches labels.json');
  return actions;
}

export async function main(argv) {
  const dryRun = argv.includes('--dry-run');
  const repoFlag = argv.indexOf('--repo');
  const repo = repoFlag === -1 ? undefined : argv[repoFlag + 1];
  if (repoFlag !== -1 && !repo) throw new Error('usage: labels.mjs [--repo owner/name] [--dry-run]');
  const manifest = loadManifest();
  await apply({ manifest, repo, dryRun });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
