import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeApiUrl } from '../../../scripts/write-api-url.mjs';

let dir = '';
const local = () => join(dir, '.env.production.local');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'api-url-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('writeApiUrl', () => {
  it('leaves an explicit VITE_API_URL alone and writes nothing', () => {
    const result = writeApiUrl({ VITE_API_URL: 'http://127.0.0.1:8254' }, dir);
    expect(result.action).toBe('explicit');
    expect(existsSync(local())).toBe(false);
  });

  it('falls back to the committed file when nothing is set', () => {
    expect(writeApiUrl({}, dir)).toEqual({ action: 'fallback' });
    expect(existsSync(local())).toBe(false);
  });

  it('clears a stale file so the fallback is real', () => {
    // A previous build wrote one -- e.g. a local run that once set
    // VITE_API_URL. Without removing it, Vite loads .env.production.local
    // ahead of .env.production and the fallback never actually happens.
    writeFileSync(local(), 'VITE_API_URL=https://stale.example\n', 'utf8');
    expect(writeApiUrl({}, dir)).toEqual({ action: 'fallback' });
    expect(existsSync(local())).toBe(false);
  });

  it('clears a stale file when an explicit VITE_API_URL takes over', () => {
    writeFileSync(local(), 'VITE_API_URL=https://stale.example\n', 'utf8');
    expect(writeApiUrl({ VITE_API_URL: 'http://127.0.0.1:8254' }, dir).action).toBe('explicit');
    expect(existsSync(local())).toBe(false);
  });

  it('refuses an explicit VITE_API_URL with an embedded newline rather than accepting it', () => {
    // new URL() strips tab/newline characters instead of rejecting them, so
    // this has to be caught before the value ever reaches the URL parser --
    // otherwise a value with an injected second line would parse "fine".
    expect(() =>
      writeApiUrl({ VITE_API_URL: 'https://evil.example\nVITE_SOMETHING=injected' }, dir),
    ).toThrow(/control characters/);
    expect(existsSync(local())).toBe(false);
  });

  it('refuses a malformed explicit VITE_API_URL', () => {
    expect(() => writeApiUrl({ VITE_API_URL: 'not a url' }, dir)).toThrow(/well-formed/);
    expect(existsSync(local())).toBe(false);
  });

  it('refuses an explicit VITE_API_URL with a non-http(s) scheme', () => {
    expect(() => writeApiUrl({ VITE_API_URL: 'javascript:alert(1)' }, dir)).toThrow(
      /http or https/,
    );
    expect(existsSync(local())).toBe(false);
  });

  it('refuses an explicit VITE_API_URL with leading or trailing whitespace', () => {
    expect(() => writeApiUrl({ VITE_API_URL: ' http://127.0.0.1:8254' }, dir)).toThrow(
      /whitespace/,
    );
    expect(existsSync(local())).toBe(false);
  });
});
