import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo, Server } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { createRouter } from '../src/http/router.js';
import { LinkService } from '../src/service.js';
import { MemoryStore } from '../src/store/memory-store.js';

let server: Server;
let base = '';

async function api(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: Record<string, never> }> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  return { status: res.status, body: (await res.json()) as Record<string, never> };
}

before(async () => {
  const handle = createRouter(new LinkService(new MemoryStore()));
  server = createServer((req, res) => {
    void handle(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('http api', () => {
  it('reports health', async () => {
    const { status, body } = await api('/api/health');
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true });
  });

  it('walks the full lifecycle of a link', async () => {
    const created = await api('/api/links', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/a', tags: ['Deep Work'] }),
    });
    assert.equal(created.status, 201);
    const link = created.body['link'] as unknown as { id: string; tags: string[] };
    assert.deepEqual(link.tags, ['deep-work']);

    const listed = await api('/api/links?q=example');
    assert.equal((listed.body['links'] as unknown as unknown[]).length, 1);

    const patched = await api(`/api/links/${link.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ read: true }),
    });
    assert.equal((patched.body['link'] as unknown as { read: boolean }).read, true);

    const unread = await api('/api/links?unread=true');
    assert.deepEqual(unread.body['links'] as unknown as unknown[], []);

    assert.equal((await api(`/api/links/${link.id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await api(`/api/links/${link.id}`)).status, 404);
  });

  it('rejects an invalid url with 400', async () => {
    const { status, body } = await api('/api/links', {
      method: 'POST',
      body: JSON.stringify({ url: 'nope' }),
    });
    assert.equal(status, 400);
    assert.match(body['error'] as unknown as string, /invalid url/);
  });

  it('rejects malformed json with 400', async () => {
    const res = await fetch(`${base}/api/links`, { method: 'POST', body: '{oops' });
    assert.equal(res.status, 400);
  });

  it('404s an unknown route', async () => {
    assert.equal((await api('/api/nothing')).status, 404);
  });

  it('serves the web ui', async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  });
});
