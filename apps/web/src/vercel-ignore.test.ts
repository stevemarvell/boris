import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decide, forkPoint, type Git } from '../../../scripts/vercel-ignore.mjs';

// A git stand-in: answers by the first argument, and records every call.
function fakeGit(answers: Record<string, { status: number; stdout?: string }>) {
  const calls: string[][] = [];
  const git: Git = (args) => {
    calls.push(args);
    const answer = answers[args[0] ?? ''] ?? { status: 0 };
    return { status: answer.status, stdout: answer.stdout ?? '' };
  };
  return { git, calls };
}

describe('decide', () => {
  it('skips when the diff since the previous deployment is empty', () => {
    const { git } = fakeGit({ diff: { status: 0 } });
    expect(decide('api', { VERCEL_GIT_PREVIOUS_SHA: 'abc' }, git).build).toBe(false);
  });

  it('builds when the diff since the previous deployment is not empty', () => {
    const { git } = fakeGit({ diff: { status: 1 } });
    expect(decide('api', { VERCEL_GIT_PREVIOUS_SHA: 'abc' }, git).build).toBe(true);
  });

  it('builds when git diff errors rather than answering', () => {
    const { git } = fakeGit({ diff: { status: 128 } });
    expect(decide('web', { VERCEL_GIT_PREVIOUS_SHA: 'abc' }, git).build).toBe(true);
  });

  it('builds an unknown project without touching git', () => {
    const { git, calls } = fakeGit({});
    expect(decide('mcp', { VERCEL_GIT_PREVIOUS_SHA: 'abc' }, git).build).toBe(true);
    expect(calls).toEqual([]);
  });

  it('fetches the previous commit when the shallow clone lacks it', () => {
    const { git, calls } = fakeGit({ 'cat-file': { status: 1 }, diff: { status: 0 } });
    expect(decide('api', { VERCEL_GIT_PREVIOUS_SHA: 'abc' }, git).build).toBe(false);
    expect(calls).toContainEqual(['fetch', '--no-tags', '--depth=1', 'origin', 'abc']);
  });

  it('builds when the previous commit cannot be fetched', () => {
    const { git } = fakeGit({ 'cat-file': { status: 1 }, fetch: { status: 128 } });
    expect(decide('api', { VERCEL_GIT_PREVIOUS_SHA: 'abc' }, git).build).toBe(true);
  });

  it("compares a branch's first push with where it left develop", () => {
    const log = 'dev123\tpar1\tnoreply@github.com\tAdd a thing (#42)\n';
    const { git, calls } = fakeGit({ log: { status: 0, stdout: log }, diff: { status: 0 } });
    expect(decide('web', {}, git).build).toBe(false);
    expect(calls.find((c) => c[0] === 'diff')?.slice(0, 4)).toEqual(['diff', '--quiet', 'dev123', 'HEAD']);
  });

  it("builds a branch's first push when no fork point is in the clone", () => {
    const { git } = fakeGit({ log: { status: 0, stdout: 'abc\tpar\tme@example.com\tWork\n' } });
    expect(decide('web', {}, git).build).toBe(true);
  });
});

describe('forkPoint', () => {
  const at = (stdout: string) => forkPoint(fakeGit({ log: { status: 0, stdout } }).git);

  it('picks the nearest squash merge, past the branch’s own commits', () => {
    expect(
      at(
        'b2\tb1\tme@example.com\tFix review finding (#7)\n' +
          'b1\td2\tme@example.com\tStart\n' +
          'd2\td1\tnoreply@github.com\tAdd a thing (#42)\n' +
          'd1\td0\tnoreply@github.com\tAdd another (#41)\n',
      ),
    ).toBe('d2');
  });

  it('never takes a GitHub "update branch" merge, which carries the branch’s own changes', () => {
    expect(
      at(
        'm1\tb1 d3\tnoreply@github.com\tMerge branch develop into feat (#9)\n' +
          'b1\td2\tme@example.com\tStart\n' +
          'd2\td1\tnoreply@github.com\tAdd a thing (#42)\n',
      ),
    ).toBe('d2');
  });

  it('gives up when git log fails', () => {
    expect(forkPoint(fakeGit({ log: { status: 128 } }).git)).toBeNull();
  });
});

// The pathspecs, against a real repository: which changes each project sees.
describe('pathspecs', () => {
  let repo: string;
  let base: string;

  const git: Git = (args) => {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    return { status: result.status ?? -1, stdout: result.stdout ?? '' };
  };
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  };
  const commit = () => {
    git(['add', '-A']);
    git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'c']);
  };
  const touching = (path: string) => {
    write(path, 'changed');
    commit();
    const env = { VERCEL_GIT_PREVIOUS_SHA: base };
    return { api: decide('api', env, git).build, web: decide('web', env, git).build };
  };

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'vercel-ignore-'));
    git(['init', '-q']);
    for (const path of ['apps/api/x', 'apps/web/x', 'docs/x', '.claude/x', '.github/x', 'CLAUDE.md', 'scripts/x']) {
      write(path, 'original');
    }
    commit();
    base = git(['rev-parse', 'HEAD']).stdout.trim();
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('skips both for a change only to agent configuration', () => {
    expect(touching('.claude/x')).toEqual({ api: false, web: false });
    expect(touching('CLAUDE.md')).toEqual({ api: false, web: false });
    expect(touching('.github/x')).toEqual({ api: false, web: false });
  });

  it('builds only the API for a change under apps/api', () => {
    expect(touching('apps/api/x')).toEqual({ api: true, web: false });
  });

  it('builds only the web app for docs, which its prebuild renders', () => {
    expect(touching('docs/x')).toEqual({ api: false, web: true });
  });

  it('builds both when the ignore script itself changes', () => {
    expect(touching('scripts/vercel-ignore.mjs')).toEqual({ api: true, web: true });
  });

  it('skips the web app for tests and CI-only scripts, which never reach the bundle', () => {
    expect(touching('apps/web/src/thing.test.ts')).toEqual({ api: false, web: false });
    expect(touching('apps/web/e2e/docs.spec.ts')).toEqual({ api: false, web: false });
    expect(touching('scripts/pr-contention.mjs')).toEqual({ api: false, web: false });
    expect(touching('scripts/paths.mjs')).toEqual({ api: false, web: false });
    expect(touching('scripts/vercel-prune.mjs')).toEqual({ api: false, web: false });
    expect(touching('scripts/write-ci-sandbox-settings.mjs')).toEqual({ api: false, web: false });
  });

  it("builds the web app for the scripts its prebuild runs", () => {
    expect(touching('scripts/build-docs.mjs')).toEqual({ api: false, web: true });
    expect(touching('scripts/markdown.mjs')).toEqual({ api: false, web: true });
  });

  it('builds the web app for a top-level path it has never heard of', () => {
    expect(touching('brand-new/x')).toEqual({ api: false, web: true });
  });
});
