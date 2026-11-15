import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isTelemetryKey } from '../user-telemetry-settings.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = join(ROOT, 'scripts', 'user-telemetry-settings.mjs');

let dir = '';
let repo = '';
let user = '';

const run = (args: string[]) =>
  spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 20_000 });
const readUser = () => JSON.parse(readFileSync(user, 'utf8'));
const writeRepo = (text: string) => {
  mkdirSync(join(repo, '.claude'), { recursive: true });
  writeFileSync(join(repo, '.claude', 'settings.json'), text);
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'user-telemetry-'));
  repo = join(dir, 'repo');
  user = join(dir, 'home', '.claude', 'settings.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('user-telemetry-settings', () => {
  it('creates the user file and directory with only the telemetry keys', { timeout: 30_000 }, () => {
    writeRepo(
      JSON.stringify({
        env: { CLAUDE_CODE_ENABLE_TELEMETRY: '1', OTEL_EXPORTER_OTLP_ENDPOINT: 'https://x/otlp', OTHER: 'no' },
        permissions: { allow: ['Bash(ls)'] },
      }),
    );
    const result = run(['--repo', repo, '--user-settings', user]);
    expect(result.status).toBe(0);
    expect(readUser()).toEqual({
      env: { CLAUDE_CODE_ENABLE_TELEMETRY: '1', OTEL_EXPORTER_OTLP_ENDPOINT: 'https://x/otlp' },
    });
  });

  it('keeps every other key in an existing user file', { timeout: 30_000 }, () => {
    writeRepo(JSON.stringify({ env: { CLAUDE_CODE_ENABLE_TELEMETRY: '1' } }));
    mkdirSync(dirname(user), { recursive: true });
    writeFileSync(
      user,
      JSON.stringify({
        theme: 'dark',
        permissions: { allow: ['x'] },
        env: { FOO: 'bar', CLAUDE_CODE_ENABLE_TELEMETRY: '0' },
      }),
    );
    expect(run(['--repo', repo, '--user-settings', user]).status).toBe(0);
    expect(readUser()).toEqual({
      theme: 'dark',
      permissions: { allow: ['x'] },
      env: { FOO: 'bar', CLAUDE_CODE_ENABLE_TELEMETRY: '1' },
    });
  });

  it('is idempotent: a second run leaves the file byte-identical', { timeout: 30_000 }, () => {
    writeRepo(JSON.stringify({ env: { CLAUDE_CODE_ENABLE_TELEMETRY: '1', OTEL_METRICS_EXPORTER: 'otlp' } }));
    run(['--repo', repo, '--user-settings', user]);
    const first = readFileSync(user, 'utf8');
    expect(run(['--repo', repo, '--user-settings', user]).status).toBe(0);
    expect(readFileSync(user, 'utf8')).toBe(first);
  });

  it('defaults the repository to the working directory and the file to $HOME', { timeout: 30_000 }, () => {
    writeRepo(JSON.stringify({ env: { CLAUDE_CODE_ENABLE_TELEMETRY: '1' } }));
    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: repo,
      encoding: 'utf8',
      timeout: 20_000,
      env: { ...process.env, HOME: join(dir, 'home') },
    });
    expect(result.status).toBe(0);
    expect(readUser().env.CLAUDE_CODE_ENABLE_TELEMETRY).toBe('1');
  });

  it('never writes a headers key, even if the repository settings carry one', { timeout: 30_000 }, () => {
    writeRepo(
      JSON.stringify({
        env: {
          CLAUDE_CODE_ENABLE_TELEMETRY: '1',
          OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Basic secret',
          OTEL_EXPORTER_OTLP_METRICS_HEADERS: 'Authorization=Basic secret',
        },
      }),
    );
    expect(run(['--repo', repo, '--user-settings', user]).status).toBe(0);
    const text = readFileSync(user, 'utf8');
    expect(text).not.toMatch(/HEADERS/);
    expect(text).not.toMatch(/secret/);
  });

  it("copies this repository's committed endpoint and no headers key", { timeout: 30_000 }, () => {
    expect(run(['--repo', ROOT, '--user-settings', user]).status).toBe(0);
    const env = readUser().env;
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toMatch(/^https:\/\//);
    expect(Object.keys(env).filter((k) => /HEADERS/.test(k))).toEqual([]);
  });

  it('exits non-zero on invalid repository settings and writes nothing', { timeout: 30_000 }, () => {
    writeRepo('{ not json');
    const result = run(['--repo', repo, '--user-settings', user]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/not valid JSON/);
    expect(() => readFileSync(user)).toThrow();
  });

  it('exits non-zero when the repository has no settings file', { timeout: 30_000 }, () => {
    const result = run(['--repo', repo, '--user-settings', user]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/not found/);
  });

  it('leaves an invalid existing user file untouched and exits non-zero', { timeout: 30_000 }, () => {
    writeRepo(JSON.stringify({ env: { CLAUDE_CODE_ENABLE_TELEMETRY: '1' } }));
    mkdirSync(dirname(user), { recursive: true });
    writeFileSync(user, '{ broken');
    const result = run(['--repo', repo, '--user-settings', user]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/User settings .* not valid JSON/);
    expect(readFileSync(user, 'utf8')).toBe('{ broken');
  });
});

describe('isTelemetryKey', () => {
  it('admits the enable flag and OTEL_* but not headers or anything else', () => {
    expect(isTelemetryKey('CLAUDE_CODE_ENABLE_TELEMETRY')).toBe(true);
    expect(isTelemetryKey('OTEL_METRICS_EXPORTER')).toBe(true);
    expect(isTelemetryKey('OTEL_EXPORTER_OTLP_HEADERS')).toBe(false);
    expect(isTelemetryKey('OTEL_EXPORTER_OTLP_LOGS_HEADERS')).toBe(false);
    expect(isTelemetryKey('PATH')).toBe(false);
  });
});
