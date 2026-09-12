#!/usr/bin/env node
// Prepare a fresh worktree: install both toolchains and report the ports this
// checkout will use. node_modules and .venv are per-worktree, not shared.
import { execSync } from 'node:child_process';
import { ports } from './ports.mjs';

const run = (command) => {
  process.stdout.write(`$ ${command}\n`);
  execSync(command, { stdio: 'inherit' });
};

run('npm ci');
run('uv sync --directory apps/api --frozen');
run('npx playwright install chromium');

const { api, web } = ports();
process.stdout.write(
  `\nThis worktree uses E2E ports api=${api} web=${web}.\n` +
    `They are derived from the directory name, so parallel worktrees do not collide.\n`,
);
