#!/usr/bin/env node
// Prepare a fresh worktree: install every app's toolchain and report the ports this
// checkout will use. node_modules and .venv are per-worktree, not shared.
import { execSync } from 'node:child_process';
import { missingPackages } from './lsp.mjs';
import { apps, deployed, loadProject } from './project.mjs';
import { ports } from './ports.mjs';

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

// One port band per deployed app, in project.json order: the same names and
// order the app's own e2e config asks ports() for.
const placed = ports(deployed(loadProject()).map(([name]) => name));
process.stdout.write(
  `\nThis worktree uses E2E ports ${Object.entries(placed).map(([name, port]) => `${name}=${port}`).join(' ')}.\n` +
    `They are derived from the directory name, so parallel worktrees do not collide.\n`,
);
