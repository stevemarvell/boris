import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fixCommands, runFixes, ROOT as FORMAT_ROOT } from '../../../.claude/hooks/format-edited.mjs';
import { ROOT as VERIFY_ROOT } from '../../../.claude/hooks/verify-on-stop.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

// A filename carrying every shell metacharacter this hook must never act on:
// backticks and $(...) run command substitution under sh, a bare quote would
// break out of a quoted string, the semicolon would end a command, and the
// space would split an unquoted argument in two.
const MALICIOUS_FILENAME = 'a`touch pwned`$(touch pwned2);"x\' y.py';

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
    const [checkCommand, formatCommand] = commands;
    if (!checkCommand || !formatCommand) throw new Error('expected two commands');
    for (const { command, args } of commands) {
      expect(command).toBe('uv');
      expect(args).toContain('--directory');
      expect(args).toContain('apps/api');
    }
    expect(checkCommand.args).toContain('check');
    expect(formatCommand.args).toContain('format');
  });

  it('routes TypeScript and JavaScript through node running eslint directly, not npx', () => {
    for (const file of ['a.ts', 'b.tsx', 'c.js', 'd.jsx', 'e.mjs']) {
      const commands = fixCommands(file);
      const [only] = commands;
      if (!only) throw new Error('expected one command');
      const { command, args } = only;
      // process.execPath (node itself) is a real binary on every platform,
      // unlike the npx/npm .cmd shims — nothing here can be a shell script.
      expect(command).toBe(process.execPath);
      expect(args[0]).toMatch(/eslint[/\\]bin[/\\]eslint\.js$/);
      expect(args).toContain('--fix');
      expect(args).toContain(file);
    }
  });

  it('leaves anything else alone', () => {
    for (const file of ['README.md', 'data/family.json', 'styles.css', 'noext']) {
      expect(fixCommands(file)).toEqual([]);
    }
  });

  it('carries a path with spaces, quotes, and shell metacharacters through as one untouched argv element', () => {
    for (const file of ['some dir/file.ts', MALICIOUS_FILENAME]) {
      for (const { args } of fixCommands(file)) {
        // The whole point of an argv array over a shell string: filePath
        // shows up as exactly one element, never split, escaped, or
        // interpolated into a larger string.
        expect(args).toContain(file);
        expect(args.filter((a) => a === file)).toHaveLength(1);
      }
    }
  });
});

describe('runFixes', () => {
  it('hands the path to exec as a literal argv element, never as part of a larger string', () => {
    const calls: Array<[string, string[], unknown]> = [];
    runFixes(MALICIOUS_FILENAME, { exec: (command, args, options) => calls.push([command, args, options]) });

    expect(calls.length).toBeGreaterThan(0);
    for (const [command, args, options] of calls) {
      expect(typeof command).toBe('string');
      expect(Array.isArray(args)).toBe(true);
      // The malicious string appears as its own array element — never
      // concatenated into a larger string that something else would parse.
      expect(args).toContain(MALICIOUS_FILENAME);
      expect(args.some((a) => a !== MALICIOUS_FILENAME && String(a).includes(MALICIOUS_FILENAME))).toBe(
        false,
      );
      // execFileSync only ever spawns a shell if told to; this hook never
      // asks for one.
      expect((options as { shell?: unknown } | undefined)?.shell).not.toBe(true);
    }
  });

  // This is the exploit itself, run for real with no mocking: if runFixes
  // ever built a shell command line out of this filename, `touch` would
  // create these marker files. It cannot, because execFileSync never
  // consults a shell — proving the vulnerability class is actually closed,
  // not just that our code calls the right-sounding API.
  it('does not execute shell metacharacters embedded in a crafted .py filename', () => {
    const markerA = join(tmpdir(), `boris-hook-test-pwned-${process.pid}-a`);
    const markerB = join(tmpdir(), `boris-hook-test-pwned-${process.pid}-b`);
    const malicious = `a\`touch ${markerA}\`$(touch ${markerB}).py`;

    expect(() => runFixes(malicious)).not.toThrow();

    expect(existsSync(markerA)).toBe(false);
    expect(existsSync(markerB)).toBe(false);
  });

  // Same proof for the TypeScript/eslint route, which is the one that used
  // to go through the npx .cmd shim.
  it('does not execute shell metacharacters embedded in a crafted .ts filename', () => {
    const marker = join(tmpdir(), `boris-hook-test-pwned-${process.pid}-c`);
    const malicious = `a\`touch ${marker}\`$(touch ${marker}).ts`;

    expect(() => runFixes(malicious)).not.toThrow();

    expect(existsSync(marker)).toBe(false);
  });
});
