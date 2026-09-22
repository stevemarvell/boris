#!/usr/bin/env node
// Prepare a fresh worktree: install both toolchains and report the ports this
// checkout will use. node_modules and .venv are per-worktree, not shared.
import { execSync } from 'node:child_process';
import { missingPackages } from './lsp.mjs';
import { ports } from './ports.mjs';

const run = (command) => {
  process.stdout.write(`$ ${command}\n`);
  execSync(command, { stdio: 'inherit' });
};

run('npm ci');
run('uv sync --directory apps/api --frozen');
run('npx playwright install chromium');

// Language servers for the LSP plugins in .claude/settings.json -- global,
// because the plugins only look on PATH. See scripts/lsp.mjs.
const packages = missingPackages();
if (packages.length) run(`npm install -g ${packages.join(' ')}`);

const { api, web } = ports();
process.stdout.write(
  `\nThis worktree uses E2E ports api=${api} web=${web}.\n` +
    `They are derived from the directory name, so parallel worktrees do not collide.\n`,
);
