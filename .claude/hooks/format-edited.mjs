#!/usr/bin/env node
// PostToolUse hook: autofix the file that was just edited, so trivial lint
// failures never become a round trip.
//
// Same cwd rule as the Stop hook: derive the root from this file, pin every
// command to it. Commands go through a shell because npx is a .cmd shim on
// Windows.
import { execSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** Returns the commands that would run, so the routing is testable. */
export function fixCommands(filePath) {
  const quoted = JSON.stringify(filePath);
  if (/\.py$/.test(filePath)) {
    return [
      `uv run --directory apps/api ruff check --fix ${quoted}`,
      `uv run --directory apps/api ruff format ${quoted}`,
    ];
  }
  if (/\.(ts|tsx|js|jsx|mjs)$/.test(filePath)) {
    return [`npx --no-install eslint --fix ${quoted}`];
  }
  return [];
}

async function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;

  let filePath;
  try {
    filePath = JSON.parse(input)?.tool_input?.file_path;
  } catch {
    return;
  }
  if (!filePath) return;

  for (const command of fixCommands(filePath)) {
    try {
      execSync(command, { cwd: ROOT, stdio: 'ignore' });
    } catch {
      // A file that cannot be autofixed is the linter's problem to report
      // during verify, not this hook's problem to block on.
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
