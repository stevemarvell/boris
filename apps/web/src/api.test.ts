import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, fetchStatus } from './api';

function mockFetch(body: unknown, ok = true, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok, status, json: async () => body }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchStatus', () => {
  it('returns the status field', async () => {
    mockFetch({ data: { status: 'ok' } });
    await expect(fetchStatus()).resolves.toBe('ok');
  });

  it('throws on a GraphQL error', async () => {
    mockFetch({ errors: [{ message: 'boom' }] });
    await expect(fetchStatus()).rejects.toThrow(ApiError);
  });

  it('throws on a non-2xx response', async () => {
    mockFetch({}, false, 502);
    await expect(fetchStatus()).rejects.toThrow(/502/);
  });

  it('throws when the payload has no data', async () => {
    mockFetch({});
    await expect(fetchStatus()).rejects.toThrow(/no data/);
  });
});
