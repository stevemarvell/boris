import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, fetchGenerations, graphql } from './api';

function mockFetch(body: unknown, ok = true, status = 200): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, status, json: async () => body }));
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
