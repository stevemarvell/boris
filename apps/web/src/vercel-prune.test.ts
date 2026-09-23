import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAX_PAGES,
  isPreview,
  listDeployments,
  main,
  prune,
  select,
  type Deployment,
  type FetchJson,
} from '../../../scripts/vercel-prune.mjs';

const preview = (uid: string, ref: string): Deployment => ({ uid, target: null, meta: { githubCommitRef: ref } });

describe('isPreview', () => {
  it('never lets a production deployment through', () => {
    expect(isPreview({ uid: 'p', target: 'production', meta: { githubCommitRef: 'feat/x' } })).toBe(false);
  });

  it('never lets a develop build through, even one not marked production', () => {
    expect(isPreview(preview('d', 'develop'))).toBe(false);
  });

  it('never lets a deployment with no branch through', () => {
    expect(isPreview({ uid: 'cli', target: null, meta: {} })).toBe(false);
    expect(isPreview({ uid: 'cli', target: null })).toBe(false);
  });

  it('lets a branch preview through', () => {
    expect(isPreview(preview('a', 'feat/x'))).toBe(true);
  });
});

describe('select', () => {
  const all = [
    preview('a', 'feat/x'),
    preview('b', 'feat/y'),
    preview('c', 'develop'),
    { uid: 'p', target: 'production', meta: { githubCommitRef: 'feat/x' } },
  ];
  const ids = (ds: Deployment[]) => ds.map((d) => d.uid);

  it("selects only the closed branch's previews", () => {
    expect(ids(select(all, { branch: 'feat/x' }))).toEqual(['a']);
  });

  it('selects previews of branches that no longer exist, keeping live ones', () => {
    expect(ids(select(all, { live: new Set(['feat/y', 'develop']) }))).toEqual(['a']);
  });

  it('cannot be talked into selecting develop or production by the rule', () => {
    expect(ids(select(all, { branch: 'develop' }))).toEqual([]);
    expect(ids(select(all, { live: new Set() }))).toEqual(['a', 'b']);
  });
});

describe('listDeployments', () => {
  it('follows pagination until Vercel stops returning a next cursor', async () => {
    const urls: string[] = [];
    const pages = [
      { deployments: [preview('a', 'x')], pagination: { next: 111 } },
      { deployments: [preview('b', 'x')], pagination: { next: null } },
    ];
    const fetchJson: FetchJson = async (url) => {
      urls.push(url);
      return pages[urls.length - 1]!;
    };
    const result = await listDeployments(fetchJson, 'family-tree-web', 'x');
    expect(result.map((d) => d.uid)).toEqual(['a', 'b']);
    expect(urls[0]).toContain('branch=x');
    expect(urls[1]).toContain('until=111');
  });

  it('stops at the page ceiling and says so, rather than looping', async () => {
    let calls = 0;
    const fetchJson: FetchJson = async () => {
      calls++;
      return { deployments: [], pagination: { next: calls } };
    };
    await expect(listDeployments(fetchJson, 'family-tree-api')).rejects.toThrow(/more than 20 pages/);
    expect(calls).toBe(MAX_PAGES);
  });
});

describe('main', () => {
  it('refuses to run without a token', async () => {
    await expect(main(['branch', 'x'], {})).rejects.toThrow(/VERCEL_TOKEN/);
  });

  it('refuses an empty live-branch list, which would mark every preview stale', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vercel-prune-'));
    const file = join(dir, 'live.txt');
    writeFileSync(file, '\n\n');
    try {
      await expect(main(['stale', file], { VERCEL_TOKEN: 't' })).rejects.toThrow(/no live branches/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a mode it does not know', async () => {
    await expect(main(['everything'], { VERCEL_TOKEN: 't' })).rejects.toThrow(/usage/);
  });
});

describe('prune', () => {
  const fetchJson: FetchJson = async (url) => ({
    deployments: url.includes('family-tree-web')
      ? [preview('w1', 'gone'), preview('w2', 'live'), { id: 'w3', target: null, meta: { githubCommitRef: 'gone' } }]
      : [preview('a1', 'gone'), { uid: 'a2', target: 'production', meta: { githubCommitRef: 'develop' } }],
    pagination: { next: null },
  });

  it('deletes the selected previews in both projects, by uid or id', async () => {
    const removed: string[] = [];
    const deleted = await prune({
      fetchJson,
      remove: async (id) => removed.push(id),
      rule: { live: new Set(['live']) },
      log: () => {},
    });
    expect(removed).toEqual(['w1', 'w3', 'a1']);
    expect(deleted.map((d) => d.project)).toEqual(['family-tree-web', 'family-tree-web', 'family-tree-api']);
  });

  it('deletes nothing on a dry run, but reports what it would', async () => {
    const removed: string[] = [];
    const lines: string[] = [];
    const deleted = await prune({
      fetchJson,
      remove: async (id) => removed.push(id),
      rule: { live: new Set(['live']) },
      dryRun: true,
      log: (line) => lines.push(line),
    });
    expect(removed).toEqual([]);
    expect(deleted).toHaveLength(3);
    expect(lines[0]).toMatch(/^would delete family-tree-web w1/);
  });
});
