import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fixCommands, ROOT as FORMAT_ROOT } from '../../../.claude/hooks/format-edited.mjs';
import { ROOT as VERIFY_ROOT } from '../../../.claude/hooks/verify-on-stop.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('hook roots', () => {
  // A hook fires with whatever working directory the session is in. Both
  // scripts used relative paths and failed with "Cannot find module" from any
  // subdirectory; vitest runs with cwd = apps/web, which is such a directory.
  it('resolve the repository root independently of the working directory', () => {
    expect(VERIFY_ROOT).toBe(REPO_ROOT);
    expect(FORMAT_ROOT).toBe(REPO_ROOT);
    expect(process.cwd()).not.toBe(REPO_ROOT);
  });
});

describe('fixCommands', () => {
  it('routes Python at ruff, pinned to the api project', () => {
    const commands = fixCommands('apps/api/src/api/tree.py');
    expect(commands).toHaveLength(2);
    expect(commands[0]).toContain('ruff check --fix');
    expect(commands[0]).toContain('--directory apps/api');
  });

  it('routes TypeScript and JavaScript at eslint', () => {
    for (const file of ['a.ts', 'b.tsx', 'c.js', 'd.jsx', 'e.mjs']) {
      expect(fixCommands(file)).toEqual([`npx --no-install eslint --fix "${file}"`]);
    }
  });

  it('leaves anything else alone', () => {
    for (const file of ['README.md', 'data/family.json', 'styles.css', 'noext']) {
      expect(fixCommands(file)).toEqual([]);
    }
  });

  it('quotes a path containing spaces', () => {
    expect(fixCommands('some dir/file.ts')[0]).toContain('"some dir/file.ts"');
  });
});
