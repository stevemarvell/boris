#!/usr/bin/env node
// Stop hook: refuse to finish while the verification loop is red.
//
// Exit 0 lets the turn end. Exit 2 blocks it and feeds stderr back to the
// model, so a failing gate becomes work to do rather than a claim to make.
//
// Commands go through a shell because npm is a .cmd shim on Windows and
// execFile cannot launch those directly.
import { execSync } from 'node:child_process';

const WATCHED = /^(apps\/|data\/|package\.json|package-lock\.json)/;

let changed = [];
try {
  changed = execSync('git status --porcelain', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    .split('\n')
    .map((line) => line.slice(3).trim())
    .filter((path) => path && WATCHED.test(path));
} catch {
  process.exit(0); // not a git repo, or git unavailable — do not block
}

if (changed.length === 0) process.exit(0);

try {
  execSync('npm run verify', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  process.exit(0);
} catch (err) {
  const output = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim().split('\n').slice(-40).join('\n');
  process.stderr.write(
    `npm run verify failed, so this work is not done.\n\n${output}\n\n` +
      `Fix it and run "npm run verify" again. Do not report the work as complete until it passes.\n`,
  );
  process.exit(2);
}
