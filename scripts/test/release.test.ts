import { describe, expect, it } from 'vitest';
import { goGiven, latestTag, nextTag, ownerSaidGo, plan, releaseNotes, tagRelease, type Pull, type Run } from '../release.mjs';

const pr = (n: number, at: string | null, base = 'develop'): Pull => ({ number: n, title: `Change ${n}`, html_url: `https://github.com/o/n/pull/${n}`, merged_at: at, base: { ref: base } });

describe('nextTag', () => {
  it('is vYYYY.MM.DD for the first release of a day', () => {
    expect(nextTag([], '2026-11-22')).toBe('v2026.11.22');
    expect(nextTag(['v2026.11.21', 'v2026.11.21-2'], '2026-11-22')).toBe('v2026.11.22');
  });
  it('adds -2, -3 for further releases the same day', () => {
    expect(nextTag(['v2026.11.22'], '2026-11-22')).toBe('v2026.11.22-2');
    expect(nextTag(['v2026.11.22', 'v2026.11.22-2'], '2026-11-22')).toBe('v2026.11.22-3');
  });
  it('ignores tags that are not release tags', () => {
    expect(nextTag(['v1.0.0', 'latest'], '2026-11-22')).toBe('v2026.11.22');
  });
  it('refuses a date it cannot read', () => {
    expect(() => nextTag([], 'soon')).toThrow(/not a date/);
  });
});

describe('latestTag', () => {
  it('orders by date then suffix, and is null with no release tag', () => {
    expect(latestTag(['v2026.11.22', 'v2026.11.22-2', 'v2026.11.09', 'v9'])).toBe('v2026.11.22-2');
    expect(latestTag(['v1.0'])).toBeNull();
  });
});

describe('releaseNotes', () => {
  const pulls = [pr(3, '2026-11-20T10:00:00Z'), pr(1, '2026-11-18T10:00:00Z'), pr(2, '2026-11-19T10:00:00Z'), pr(4, null), pr(5, '2026-11-21T10:00:00Z', 'main')];
  it('lists, oldest first, every pull request merged into develop after the last release, with links', () => {
    expect(releaseNotes(pulls, { since: '2026-11-18T12:00:00Z' })).toBe(
      '- Change 2 ([#2](https://github.com/o/n/pull/2))\n- Change 3 ([#3](https://github.com/o/n/pull/3))',
    );
  });
  it('lists everything merged for a first release, and skips unmerged and other-base pulls', () => {
    expect(releaseNotes(pulls).split('\n')).toHaveLength(3);
  });
  it('says so when nothing merged', () => {
    expect(releaseNotes(pulls, { since: '2026-12-01T00:00:00Z' })).toMatch(/No pull requests/);
  });
});

describe('ownerSaidGo', () => {
  const c = (login: string, body: string, created_at = '2026-11-22T10:00:00Z') => ({ user: { login }, body, created_at });
  it('accepts go from the owner, whatever the case or full stop', () => {
    expect(ownerSaidGo({ owner: 'Steve', comments: [c('steve', ' Go abc1234. ')], headSha: 'abc1234ff' })).toBe(true);
  });
  it('ignores a stranger saying go, and the owner merely mentioning it', () => {
    expect(ownerSaidGo({ owner: 'steve', comments: [c('mallory', 'go abc1234')], headSha: 'abc1234ff' })).toBe(false);
    expect(ownerSaidGo({ owner: 'steve', comments: [c('steve', 'not yet, no go'), c('steve', 'go ahead')], headSha: 'abc1234ff' })).toBe(false);
  });
  const head = 'abc1234def5678abc1234def5678abc1234def56';
  it('accepts go <sha> naming the head, from 7 characters up to the whole sha', () => {
    expect(ownerSaidGo({ owner: 'steve', comments: [c('steve', 'go abc1234')], headSha: head })).toBe(true);
    expect(ownerSaidGo({ owner: 'steve', comments: [c('steve', 'Go ABC1234DEF5678.')], headSha: head })).toBe(true);
    expect(ownerSaidGo({ owner: 'steve', comments: [c('steve', `go ${head}`)], headSha: head })).toBe(true);
  });
  it('refuses a sha that is not the head, one under 7 characters, and a bare go', () => {
    expect(ownerSaidGo({ owner: 'steve', comments: [c('steve', 'go 1111111')], headSha: head })).toBe(false);
    expect(ownerSaidGo({ owner: 'steve', comments: [c('steve', 'go abc123')], headSha: head })).toBe(false);
    expect(ownerSaidGo({ owner: 'steve', comments: [c('steve', 'go')], headSha: head })).toBe(false);
    expect(ownerSaidGo({ owner: 'steve', comments: [c('mallory', 'go abc1234')], headSha: head })).toBe(false);
  });
  it('accepts the owner having merged it, not someone else', () => {
    expect(ownerSaidGo({ owner: 'steve', comments: [], mergedBy: 'steve' })).toBe(true);
    expect(ownerSaidGo({ owner: 'steve', comments: [], mergedBy: 'a-bot' })).toBe(false);
  });
});

/** A fake gh: routes by substring, records every call. */
function gh(routes: Record<string, unknown>) {
  const calls: string[] = [];
  const run: Run = async (cmd, args) => {
    const key = `${cmd} ${args.join(' ')}`;
    calls.push(key);
    const hit = Object.entries(routes).find(([k]) => key.includes(k));
    return hit ? { status: 0, stdout: JSON.stringify(hit[1]), stderr: '' } : { status: 1, stdout: '', stderr: `no route for ${key}` };
  };
  return { run, calls };
}

describe('against the REST API', () => {
  const sha = (n: number) => String(n).repeat(40);
  /** Commits on develop that main lacks, as the compare endpoint returns them. */
  const compare = (shas: string[]) => ({ total_commits: shas.length, commits: shas.map((s) => ({ sha: s })) });

  it('plan: notes are the PRs behind what develop has and main lacks, so a PR merged while a release PR is open waits for the next release', async () => {
    // Monday A and Tuesday B are released; Wednesday C merges into develop while the release PR is open.
    const A = pr(1, '2026-11-16T10:00:00Z');
    const B = pr(2, '2026-11-17T10:00:00Z');
    const C = pr(3, '2026-11-18T10:00:00Z');
    const tags = { 'repos/o/n/tags': [{ name: 'v2026.11.16' }] };
    const pulls = { [`commits/${sha(1)}/pulls`]: [A], [`commits/${sha(2)}/pulls`]: [B, B], [`commits/${sha(3)}/pulls`]: [C] };
    const cut = gh({ ...tags, 'compare/main...develop': compare([sha(1), sha(2)]), ...pulls });
    const first = await plan({ run: cut.run, repo: 'o/n', date: '2026-11-17' });
    expect(first.notes).toBe('- Change 1 ([#1](https://github.com/o/n/pull/1))\n- Change 2 ([#2](https://github.com/o/n/pull/2))');
    // After that release merges into main, only C is ahead.
    const next = gh({ ...tags, 'compare/main...develop': compare([sha(3)]), ...pulls });
    const second = await plan({ run: next.run, repo: 'o/n', date: '2026-11-19' });
    expect(second.notes).toBe('- Change 3 ([#3](https://github.com/o/n/pull/3))');
  });

  it('plan: pages the compare, and stops at the ceiling rather than truncate', async () => {
    const calls: string[] = [];
    const run: Run = async (_c, args) => {
      calls.push(args[1]!);
      if (args[1]!.includes('/tags')) return { status: 0, stdout: '[]', stderr: '' };
      if (args[1]!.includes('compare')) return { status: 0, stdout: JSON.stringify({ total_commits: 9999, commits: [{ sha: sha(1) }] }), stderr: '' };
      return { status: 0, stdout: '[]', stderr: '' };
    };
    await expect(plan({ run, repo: 'o/n', date: '2026-11-22' })).rejects.toThrow(/declared ceiling/);
    expect(calls.filter((c) => c.includes('compare')).length).toBe(5);
  });

  it('goGiven: a stranger go is ignored, the owner go <head sha> counts, and it names the head sha to merge', async () => {
    const base = { 'pulls/7': { merged: false, head: { sha: 'abc1234def' } } };
    const stranger = gh({ ...base, 'issues/7/comments': [{ user: { login: 'mallory' }, body: 'go abc1234', created_at: '2026-11-22T10:00:00Z' }] });
    expect((await goGiven({ run: stranger.run, repo: 'o/n', pr: 7 })).given).toBe(false);
    const owner = gh({ ...base, 'issues/7/comments': [{ user: { login: 'o' }, body: 'go abc1234', created_at: '2026-11-22T10:00:00Z' }] });
    expect(await goGiven({ run: owner.run, repo: 'o/n', pr: 7 })).toEqual({ given: true, sha: 'abc1234def' });
  });

  it('goGiven: a go, then a back-dated commit pushed after it, is not a go, and the new head sha is reported', async () => {
    // The pushed commit's committer date (09:00) is earlier than the go (10:00): dates cannot tell, the sha can.
    const moved = gh({
      'pulls/7': { merged: false, head: { sha: 'fed9876abc' } },
      'commits/fed9876abc': { commit: { committer: { date: '2026-11-22T09:00:00Z' } } },
      'issues/7/comments': [{ user: { login: 'o' }, body: 'go abc1234', created_at: '2026-11-22T10:00:00Z' }],
    });
    expect(await goGiven({ run: moved.run, repo: 'o/n', pr: 7 })).toEqual({ given: false, sha: 'fed9876abc' });
  });

  it('goGiven: a go naming a mismatched sha is refused', async () => {
    const wrong = gh({ 'pulls/7': { merged: false, head: { sha: 'abc1234def' } }, 'issues/7/comments': [{ user: { login: 'o' }, body: 'go 9999999' }] });
    expect((await goGiven({ run: wrong.run, repo: 'o/n', pr: 7 })).given).toBe(false);
  });

  it('tagRelease: tags the merge commit by REST and creates the Release with the PR body; refuses an unmerged PR', async () => {
    const merged = gh({
      'pulls/7': { merged: true, base: { ref: 'main' }, merge_commit_sha: 'abc', body: 'NOTES' },
      'repos/o/n/tags': [{ name: 'v2026.11.22' }],
      'git/refs': {},
      'releases': { html_url: 'https://github.com/o/n/releases/tag/x' },
    });
    const result = await tagRelease({ run: merged.run, repo: 'o/n', pr: 7, date: '2026-11-22' });
    expect(result.tag).toBe('v2026.11.22-2');
    expect(merged.calls.some((c) => c.includes('ref=refs/tags/v2026.11.22-2') && c.includes('sha=abc'))).toBe(true);
    expect(merged.calls.some((c) => c.includes('body=NOTES'))).toBe(true);
    expect(merged.calls.every((c) => c.startsWith('gh api '))).toBe(true);
    const open = gh({ 'pulls/7': { merged: false, base: { ref: 'main' } } });
    await expect(tagRelease({ run: open.run, repo: 'o/n', pr: 7, date: '2026-11-22' })).rejects.toThrow(/not a merged pull request into main/);
  });
});
