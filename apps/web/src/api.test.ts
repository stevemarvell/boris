import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, fetchGenerations, graphql, parseRetryAfter, REQUEST_TIMEOUT_MS } from './api';

function mockFetch(body: unknown, ok = true, status = 200, headers: Record<string, string> = {}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status,
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
      json: async () => body,
    }),
  );
}

/**
 * A fetch that behaves the way a real hanging request does: it never settles on
 * its own and only rejects when the caller's signal aborts. Without this the
 * timeout path cannot be tested at all — a mock that rejects promptly proves
 * nothing about a request that never comes back.
 */
function mockHangingFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init.signal;
        if (!signal) return; // no signal: hang forever, which is the bug
        signal.addEventListener('abort', () => reject(signal.reason as Error));
      });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('graphql', () => {
  it('throws on a GraphQL error', async () => {
    mockFetch({ errors: [{ message: 'boom' }] });
    await expect(graphql('{ x }')).rejects.toThrow(ApiError);
  });

  it('throws on a non-2xx response', async () => {
    mockFetch({}, false, 502);
    await expect(graphql('{ x }')).rejects.toThrow(/502/);
  });

  it('throws when the payload has no data', async () => {
    mockFetch({});
    await expect(graphql('{ x }')).rejects.toThrow(/no data/);
  });

  it('gives up on a request that never comes back', async () => {
    mockHangingFetch();
    const err = await graphql('{ x }', 20).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).failure).toBe('timeout');
    // The message has to tell the user what happened and hint at why, since it
    // is what App.tsx puts on the screen.
    expect((err as ApiError).message).toMatch(/did not answer/);
    expect((err as ApiError).message).toMatch(/waking up/);
  });

  it('passes an abort signal to fetch, so nothing can hang indefinitely', async () => {
    mockFetch({ data: { x: 1 } });
    await graphql('{ x }', 1000);
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal?.aborted).toBe(false);
  });

  it('defaults to a timeout long enough to survive a Railway cold start', () => {
    // A short timeout would turn a working wake into a visible failure, which
    // is worse than the hang. Thirty seconds matches `smoke`'s --max-time.
    expect(REQUEST_TIMEOUT_MS).toBe(30_000);
  });

  it('classifies an abort by the rejection name, not by inheritance', async () => {
    // fetch rejects with a DOMException, and a DOMException is not an Error
    // everywhere it runs. Narrowing with `instanceof Error` filed every timeout
    // as a network failure, which is the difference between "it may be waking
    // up" and "the server could not be reached".
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('signal timed out', 'TimeoutError')),
    );
    const err = await graphql('{ x }').catch((e: unknown) => e);

    expect((err as ApiError).failure).toBe('timeout');
  });

  it('reports an unreachable server as offline rather than as a timeout', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const err = await graphql('{ x }').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).failure).toBe('offline');
  });

  it('marks a 429 as rate-limited and carries its Retry-After', async () => {
    mockFetch({}, false, 429, { 'retry-after': '12' });
    const err = await graphql('{ x }').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    // Distinct from a timeout on purpose: this is the failure an automatic
    // retry makes worse, and App.tsx keys its no-auto-retry rule on it.
    expect((err as ApiError).failure).toBe('rate-limited');
    expect((err as ApiError).retryAfterMs).toBe(12_000);
  });

  it('still reports a 429 that omits Retry-After', async () => {
    mockFetch({}, false, 429);
    const err = await graphql('{ x }').catch((e: unknown) => e);

    expect((err as ApiError).failure).toBe('rate-limited');
    expect((err as ApiError).retryAfterMs).toBeNull();
  });
});

describe('parseRetryAfter', () => {
  it('reads a count of seconds', () => {
    expect(parseRetryAfter('30')).toBe(30_000);
  });

  it('reads an HTTP date', () => {
    const now = Date.parse('2026-09-13T12:00:00Z');
    expect(parseRetryAfter('Sun, 13 Sep 2026 12:00:45 GMT', now)).toBe(45_000);
  });

  it('never returns a negative wait for a date already past', () => {
    const now = Date.parse('2026-09-13T12:00:00Z');
    expect(parseRetryAfter('Sun, 13 Sep 2026 11:59:00 GMT', now)).toBe(0);
  });

  it('caps an absurd wait rather than disabling the button for an hour', () => {
    expect(parseRetryAfter('86400')).toBe(5 * 60_000);
  });

  it('ignores a missing or unparseable header', () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('')).toBeNull();
    expect(parseRetryAfter('soon')).toBeNull();
  });
});

describe('fetchGenerations', () => {
  it('returns generations in the order the API gave them', async () => {
    mockFetch({
      data: {
        generations: [
          { depth: 0, people: [{ id: 'albert-shaw', name: 'Albert Shaw' }] },
          { depth: 1, people: [{ id: 'frank-shaw', name: 'Frank Shaw' }] },
        ],
      },
    });
    const generations = await fetchGenerations();
    expect(generations.map((g) => g.depth)).toEqual([0, 1]);
    expect(generations[0]?.people[0]?.name).toBe('Albert Shaw');
  });

  it('handles an empty tree', async () => {
    mockFetch({ data: { generations: [] } });
    await expect(fetchGenerations()).resolves.toEqual([]);
  });

  it('posts to the graphql endpoint', async () => {
    mockFetch({ data: { generations: [] } });
    await fetchGenerations();
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/graphql$/);
    expect(init.method).toBe('POST');
  });
});
