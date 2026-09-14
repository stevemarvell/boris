import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fixCommands, runFixes, ROOT as FORMAT_ROOT } from '../../../.claude/hooks/format-edited.mjs';
import { ROOT as VERIFY_ROOT } from '../../../.claude/hooks/verify-on-stop.mjs';
import { decide, filterCommand } from '../../../.claude/hooks/filter-verbose.mjs';
import {
  clearAdvice,
  CLEAR_AT_PERCENT,
  COLD_CACHE_CLEAR_AT_PERCENT,
  render,
} from '../../../.claude/statusline.mjs';

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

describe('filterCommand', () => {
  it('shrinks the command whose output is worst, a CI log', () => {
    const result = filterCommand('gh run view 123 --log-failed');
    expect(result?.name).toBe('gh-run-log');
    expect(result?.command).toContain('grep');
    expect(result?.command).toMatch(/head -\d+$/);
  });

  it('keeps context after a match, not just the matching line', () => {
    // A filter that shows "error" and hides the reason costs a re-run, which
    // is more than the filter saved.
    for (const command of ['gh run view 1 --log', 'npm run verify']) {
      expect(filterCommand(command)?.command).toContain('-A');
    }
  });

  it('leaves a command that already pipes or redirects alone', () => {
    // The caller has said what they want; wrapping it would fight them.
    for (const command of [
      'gh run view 123 --log | grep something',
      'npm run verify > out.txt',
      'npm audit && echo done',
      'npm run verify; ls',
    ]) {
      expect(filterCommand(command), command).toBeNull();
    }
  });

  it('passes through anything not on the list', () => {
    for (const command of ['git status', 'ls -la', 'npm run dev', 'gh pr list']) {
      expect(filterCommand(command), command).toBeNull();
    }
  });

  it('does not fire on gh run view without a log flag', () => {
    // That form prints a short step list, which is the thing worth reading.
    expect(filterCommand('gh run view 123')).toBeNull();
  });

  it('survives input that is not a command', () => {
    for (const bad of [undefined, null, 42, '', '   ']) {
      expect(filterCommand(bad as unknown as string)).toBeNull();
    }
  });
});

describe('decide', () => {
  it('rewrites a Bash command in the shape a PreToolUse hook must emit', () => {
    const output = decide({
      tool_name: 'Bash',
      tool_input: { command: 'gh run view 9 --log', description: 'read the log' },
    }) as {
      hookSpecificOutput?: {
        hookEventName: string;
        permissionDecision: string;
        updatedInput: { command: string; description: string };
      };
    };

    expect(output.hookSpecificOutput?.hookEventName).toBe('PreToolUse');
    expect(output.hookSpecificOutput?.permissionDecision).toBe('allow');
    expect(output.hookSpecificOutput?.updatedInput.command).toContain('grep');
    // The rest of the input has to survive, or the tool call loses fields.
    expect(output.hookSpecificOutput?.updatedInput.description).toBe('read the log');
  });

  it('has no opinion about tools that are not Bash', () => {
    expect(decide({ tool_name: 'Read', tool_input: { file_path: 'x' } })).toEqual({});
  });

  it('has no opinion about a malformed payload', () => {
    // A hook that cannot read its input must never block the tool call.
    for (const bad of [null, undefined, {}, { tool_name: 'Bash' }]) {
      expect(decide(bad)).toEqual({});
    }
  });
});

describe('clearAdvice', () => {
  it('says nothing while the conversation is small', () => {
    expect(clearAdvice({ contextPercent: 10, cacheWarm: true })).toBeNull();
  });

  it('nudges once the context is large enough to be worth re-sending', () => {
    expect(clearAdvice({ contextPercent: CLEAR_AT_PERCENT, cacheWarm: true })).toBe(
      '/clear between tasks',
    );
  });

  it('nudges sooner when the cache is cold', () => {
    // Cold plus large is the most expensive single message available: the next
    // turn reprocesses the whole conversation at the uncached rate.
    const cold = clearAdvice({ contextPercent: COLD_CACHE_CLEAR_AT_PERCENT, cacheWarm: false });
    expect(cold).toContain('cache cold');
    expect(clearAdvice({ contextPercent: COLD_CACHE_CLEAR_AT_PERCENT, cacheWarm: true })).toBeNull();
  });

  it('says nothing when the context is unknown', () => {
    expect(clearAdvice({ contextPercent: null, cacheWarm: false })).toBeNull();
  });
});

describe('statusline render', () => {
  const payload = {
    model: { display_name: 'Opus' },
    workspace: { git_worktree: 'develop' },
    context_window: { used_percentage: 61 },
    rate_limits: { five_hour: { used_percentage: 12 }, seven_day: { used_percentage: 78 } },
    prompt_cache: { warm: true },
  };

  it('shows the three numbers that answer different questions', () => {
    const line = render(payload);
    expect(line).toContain('Opus · develop');
    expect(line).toContain('61%');
    expect(line).toContain('5h 12%');
    expect(line).toContain('wk 78%');
    expect(line).toContain('/clear');
  });

  it('stays quiet about the cache while it is warm', () => {
    expect(render(payload)).not.toContain('cache cold');
  });

  it('mentions a cold cache once, not twice', () => {
    // The advice sentence explains it; a separate cell would just repeat it.
    const line = render({ ...payload, prompt_cache: { warm: false } });
    expect(line).toContain('cache cold');
    expect(line.match(/cache cold/g)).toHaveLength(1);
  });

  it('still flags a cold cache when the context is too small to advise on', () => {
    const line = render({
      ...payload,
      context_window: { used_percentage: 5 },
      prompt_cache: { warm: false },
    });
    expect(line).toContain('cache cold');
    expect(line).not.toContain('⚠');
  });

  it('degrades to the model name rather than throwing', () => {
    // A status line that throws leaves the bar blank and says nothing at all.
    for (const bad of [null, undefined, {}, 'nonsense', 42]) {
      expect(() => render(bad)).not.toThrow();
    }
    expect(render({})).toBe('claude');
  });
});
