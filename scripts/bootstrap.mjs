#!/usr/bin/env node
// Prepare a fresh worktree: install every app's toolchain and report the ports this
// checkout will use. node_modules and .venv are per-worktree, not shared.
import { execSync } from 'node:child_process';
import { missingPackages } from './lsp.mjs';
import { apps, loadProject } from './project.mjs';
import { BAND, BASE_PORT, portOffset } from './ports.mjs';

const run = (command) => {
  process.stdout.write(`$ ${command}\n`);
  execSync(command, { stdio: 'inherit' });
};

run('npm ci');
// Every Python app in project.json (#173); node apps are npm workspaces.
for (const [, app] of apps(loadProject(), 'python')) run(`uv sync --directory ${app.path} --frozen`);
run('npx playwright install chromium');

// Language servers for the LSP plugins in .claude/settings.json -- global,
// because the plugins only look on PATH. See scripts/lsp.mjs.
const packages = missingPackages();
if (packages.length) run(`npm install -g ${packages.join(' ')}`);

// Which servers an app's e2e suite starts is the app's business (its own
// ports() call), so this reports only the rule and this worktree's offset,
// not a list of names it would have to guess (#180's review).
const offset = portOffset();
process.stdout.write(
  `\nThis worktree's E2E port offset is ${offset}: the nth server an e2e config names gets ` +
    `${BASE_PORT} + ${BAND}×(n-1) + ${offset}, so the first is ${BASE_PORT + offset}.\n` +
    `Derived from the directory name, so parallel worktrees do not collide.\n`,
);
