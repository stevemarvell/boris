import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prApiUrl, writeApiUrl } from '../../../scripts/write-api-url.mjs';

let dir = '';
const local = () => join(dir, '.env.production.local');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'api-url-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('prApiUrl', () => {
  it('substitutes the pull request number', () => {
    expect(prApiUrl(20)).toBe('https://api-boris-pr-20.up.railway.app');
    expect(prApiUrl('21')).toBe('https://api-boris-pr-21.up.railway.app');
  });
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

  it('points a pull request preview at its own Railway environment', () => {
    // The Railway integration syncs production's API_URL into Vercel for
    // previews too, so without this a preview shows production's data.
    const result = writeApiUrl(
      { VERCEL_GIT_PULL_REQUEST_ID: '20', API_URL: 'https://api-production-53f7b.up.railway.app' },
      dir,
    );
    expect(result).toEqual({ action: 'pr', url: 'https://api-boris-pr-20.up.railway.app' });
    expect(readFileSync(local(), 'utf8')).toContain('api-boris-pr-20');
  });

  it('lets the PR url template be overridden', () => {
    const result = writeApiUrl(
      { VERCEL_GIT_PULL_REQUEST_ID: '7', RAILWAY_PR_API_TEMPLATE: 'https://x-{pr}.example' },
      dir,
    );
    expect(result.url).toBe('https://x-7.example');
  });

  it('still prefers an explicit VITE_API_URL over a pull request', () => {
    const result = writeApiUrl(
      { VITE_API_URL: 'http://127.0.0.1:8254', VERCEL_GIT_PULL_REQUEST_ID: '20' },
      dir,
    );
    expect(result.action).toBe('explicit');
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
