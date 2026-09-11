import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { search } from '../src/domain/search.js';
import type { Link } from '../src/domain/types.js';

function link(over: Partial<Link> & Pick<Link, 'id'>): Link {
  return {
    url: 'https://example.com',
    title: 'Example',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    read: false,
    ...over,
  };
}

const corpus: Link[] = [
  link({ id: 'a', title: 'Rust ownership', tags: ['rust'], createdAt: '2026-01-01T00:00:00.000Z' }),
  link({
    id: 'b',
    title: 'Old post',
    url: 'https://rust-lang.org/blog',
    createdAt: '2026-03-01T00:00:00.000Z',
  }),
  link({ id: 'c', title: 'Gardening', tags: ['rust'], read: true, createdAt: '2026-02-01T00:00:00.000Z' }),
];

describe('search', () => {
  it('returns everything newest-first for an empty query', () => {
    assert.deepEqual(search(corpus, {}).map((l) => l.id), ['b', 'c', 'a']);
  });

  it('ranks a title hit above a url hit', () => {
    assert.deepEqual(search(corpus, { text: 'rust' }).map((l) => l.id), ['a', 'b', 'c']);
  });

  it('filters by tag', () => {
    assert.deepEqual(search(corpus, { tag: 'rust' }).map((l) => l.id), ['c', 'a']);
  });

  it('filters unread', () => {
    assert.deepEqual(search(corpus, { unreadOnly: true }).map((l) => l.id), ['b', 'a']);
  });

  it('combines tag and text filters', () => {
    assert.deepEqual(search(corpus, { tag: 'rust', text: 'garden' }).map((l) => l.id), ['c']);
  });

  it('returns nothing when no document matches', () => {
    assert.deepEqual(search(corpus, { text: 'zzz' }), []);
  });
});
