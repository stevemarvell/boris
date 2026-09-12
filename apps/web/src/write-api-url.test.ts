import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  it('maps API_URL onto VITE_API_URL', () => {
    const result = writeApiUrl({ API_URL: 'https://pr-123.up.railway.app' }, dir);
    expect(result).toEqual({ action: 'mapped', url: 'https://pr-123.up.railway.app' });
    expect(readFileSync(local(), 'utf8')).toBe('VITE_API_URL=https://pr-123.up.railway.app\n');
  });

  it('leaves an explicit VITE_API_URL alone and writes nothing', () => {
    const result = writeApiUrl({ VITE_API_URL: 'http://127.0.0.1:8254', API_URL: 'https://x' }, dir);
    expect(result.action).toBe('explicit');
    expect(existsSync(local())).toBe(false);
  });

  it('falls back to the committed file when neither is set', () => {
    expect(writeApiUrl({}, dir)).toEqual({ action: 'fallback' });
    expect(existsSync(local())).toBe(false);
  });

  it('clears a stale file so the fallback is real', () => {
    // A previous build wrote one. Without removing it, Vite loads
    // .env.production.local ahead of .env.production and the fallback never
    // actually happens.
    writeFileSync(local(), 'VITE_API_URL=https://stale.example\n', 'utf8');
    expect(writeApiUrl({}, dir)).toEqual({ action: 'fallback' });
    expect(existsSync(local())).toBe(false);
  });

  it('clears a stale file when an explicit VITE_API_URL takes over', () => {
    writeFileSync(local(), 'VITE_API_URL=https://stale.example\n', 'utf8');
    expect(writeApiUrl({ VITE_API_URL: 'http://127.0.0.1:8254' }, dir).action).toBe('explicit');
    expect(existsSync(local())).toBe(false);
  });

  it('overwrites a stale file with the current API_URL', () => {
    writeFileSync(local(), 'VITE_API_URL=https://stale.example\n', 'utf8');
    writeApiUrl({ API_URL: 'https://fresh.example' }, dir);
    expect(readFileSync(local(), 'utf8')).toContain('fresh.example');
  });
});
