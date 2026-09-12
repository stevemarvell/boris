#!/usr/bin/env node
// PostToolUse hook: autofix the file that was just edited, so trivial lint
// failures never become a round trip.
//
// Commands go through a shell because npx is a .cmd shim on Windows.
import { execSync } from 'node:child_process';

let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) input += chunk;

let filePath;
try {
  filePath = JSON.parse(input)?.tool_input?.file_path;
} catch {
  process.exit(0);
}
if (!filePath) process.exit(0);

const run = (command) => {
  try {
    execSync(command, { stdio: 'ignore' });
  } catch {
    // A file that cannot be autofixed is the linter's problem to report
    // during verify, not this hook's problem to block on.
  }
};

const quoted = JSON.stringify(filePath);
if (/\.py$/.test(filePath)) {
  run(`uv run --directory apps/api ruff check --fix ${quoted}`);
  run(`uv run --directory apps/api ruff format ${quoted}`);
} else if (/\.(ts|tsx|js|jsx|mjs)$/.test(filePath)) {
  run(`npx --no-install eslint --fix ${quoted}`);
}
