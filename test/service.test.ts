import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { NotFoundError, ValidationError } from '../src/domain/types.js';
import { LinkService } from '../src/service.js';
import { FileStore } from '../src/store/file-store.js';
import { MemoryStore } from '../src/store/memory-store.js';

/** A fixed clock and counter so ids and timestamps are deterministic. */
function makeService(): LinkService {
  let n = 0;
  return new LinkService(
    new MemoryStore(),
    { now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, n)) },
    () => `id-${++n}`,
  );
}

describe('LinkService', () => {
  it('adds a link with derived defaults', async () => {
    const link = await makeService().add({ url: 'https://example.com/a' });
    assert.equal(link.id, 'id-1');
    assert.equal(link.title, 'example.com/a');
    assert.equal(link.read, false);
  });

  it('is idempotent on url', async () => {
    const service = makeService();
    const first = await service.add({ url: 'https://example.com/a' });
    const second = await service.add({ url: 'https://example.com/a#section' });
    assert.equal(second.id, first.id);
    assert.equal((await service.list()).length, 1);
  });

  it('rejects a bad url', async () => {
    await assert.rejects(() => makeService().add({ url: 'nope' }), ValidationError);
  });

  it('marks a link read', async () => {
    const service = makeService();
    const link = await service.add({ url: 'https://example.com' });
    assert.equal((await service.markRead(link.id, true)).read, true);
    assert.equal((await service.get(link.id)).read, true);
  });

  it('throws NotFoundError for a missing id', async () => {
    await assert.rejects(() => makeService().get('nope'), NotFoundError);
    await assert.rejects(() => makeService().remove('nope'), NotFoundError);
  });

  it('counts tags, most used first', async () => {
    const service = makeService();
    await service.add({ url: 'https://a.com', tags: ['read', 'rust'] });
    await service.add({ url: 'https://b.com', tags: ['rust'] });
    assert.deepEqual(await service.tags(), [
      { tag: 'rust', count: 2 },
      { tag: 'read', count: 1 },
    ]);
  });
});

describe('FileStore', () => {
  let dir = '';

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'linkjar-'));
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('survives a reopen', async () => {
    const path = join(dir, 'links.json');
    const first = new LinkService(new FileStore(path));
    const link = await first.add({ url: 'https://example.com', tags: ['x'] });

    const reopened = new LinkService(new FileStore(path));
    assert.deepEqual(await reopened.get(link.id), link);
  });

  it('starts empty when the file does not exist', async () => {
    const service = new LinkService(new FileStore(join(dir, 'missing.json')));
    assert.deepEqual(await service.list(), []);
  });
});
