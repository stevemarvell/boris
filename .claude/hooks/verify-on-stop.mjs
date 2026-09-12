#!/usr/bin/env node
// Stop hook: refuse to finish while the verification loop is red.
//
// Exit 0 lets the turn end. Exit 2 blocks it and feeds stderr back to the
// model, so a failing gate becomes work to do rather than a claim to make.
//
// Paths are derived from this file's own location and every command is run
// with cwd pinned to the repository root: a hook fires with whatever working
// directory the session happens to be in, and a relative path fails outright
// from a subdirectory. Commands go through a shell because npm is a .cmd shim
// on Windows and execFile cannot launch those.
import { execSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const WATCHED = /^(apps\/|data\/|package\.json|package-lock\.json)/;

const run = (command) =>
  execSync(command, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

export function changedFiles() {
  return run('git status --porcelain')
    .split('\n')
    .map((line) => line.slice(3).trim())
    .filter((path) => path && WATCHED.test(path));
}

function main() {
  let changed;
  try {
    changed = changedFiles();
  } catch {
    return 0; // not a git repo, or git unavailable — do not block
  }
  if (changed.length === 0) return 0;

  try {
    run('npm run verify');
    return 0;
  } catch (err) {
    const output = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim().split('\n').slice(-40).join('\n');
    process.stderr.write(
      `npm run verify failed, so this work is not done.\n\n${output}\n\n` +
        `Fix it and run "npm run verify" again. Do not report the work as complete until it passes.\n`,
    );
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
