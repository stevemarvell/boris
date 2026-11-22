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
  const c = (login: string, body: string) => ({ user: { login }, body });
  it('accepts go from the owner, whatever the case or full stop', () => {
    expect(ownerSaidGo({ owner: 'Steve', comments: [c('steve', ' Go. ')] })).toBe(true);
  });
  it('ignores a stranger saying go, and the owner merely mentioning it', () => {
    expect(ownerSaidGo({ owner: 'steve', comments: [c('mallory', 'go')] })).toBe(false);
    expect(ownerSaidGo({ owner: 'steve', comments: [c('steve', 'not yet, no go'), c('steve', 'go ahead')] })).toBe(false);
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
  it('plan: next tag and notes since the last tag commit', async () => {
    const { run } = gh({
      'repos/o/n/tags': [{ name: 'v2026.11.18' }],
      'repos/o/n/commits/v2026.11.18': { commit: { committer: { date: '2026-11-18T12:00:00Z' } } },
      'repos/o/n/pulls?state=closed&base=develop': [pr(1, '2026-11-18T10:00:00Z'), pr(2, '2026-11-19T10:00:00Z')],
    });
    const result = await plan({ run, repo: 'o/n', date: '2026-11-22' });
    expect(result.tag).toBe('v2026.11.22');
    expect(result.notes).toBe('- Change 2 ([#2](https://github.com/o/n/pull/2))');
  });

  it('goGiven: the stranger go is ignored, the owner go counts', async () => {
    const pull = { merged: false };
    const stranger = gh({ 'pulls/7': pull, 'issues/7/comments': [{ user: { login: 'mallory' }, body: 'go' }] });
    expect(await goGiven({ run: stranger.run, repo: 'o/n', pr: 7 })).toBe(false);
    const owner = gh({ 'pulls/7': pull, 'issues/7/comments': [{ user: { login: 'o' }, body: 'go' }] });
    expect(await goGiven({ run: owner.run, repo: 'o/n', pr: 7 })).toBe(true);
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
