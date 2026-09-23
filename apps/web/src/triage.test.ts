import { describe, expect, it } from 'vitest';
import {
  MAX_ISSUES_PER_RUN,
  claimedIssues,
  openDependencies,
  render,
  triage,
} from '../../../scripts/triage.mjs';

const issue = (number: number, labels: string[], body = '') => ({
  number,
  title: `issue ${number}`,
  labels,
  body,
});

describe('triage', () => {
  it('orders by rank, security first within a rank, then oldest first', () => {
    const { work } = triage(
      [
        issue(5, ['medium']),
        issue(4, ['high']),
        issue(3, ['medium', 'security']),
        issue(2, []),
        issue(1, ['medium']),
        issue(6, ['critical']),
      ],
      [],
      Infinity,
    );
    expect(work.map((w) => w.number)).toEqual([6, 4, 3, 1, 5, 2]);
    expect(work.map((w) => w.rank)).toEqual(['critical', 'high', 'medium', 'medium', 'medium', 'unranked']);
  });

  it('skips anything a person owns, whichever label says so', () => {
    const { work, skip } = triage(
      [
        issue(1, ['medium', 'human']),
        issue(2, ['do not automate']),
        issue(3, ['blocked: no paid plan']),
        issue(4, ['medium']),
      ],
      [],
    );
    expect(work.map((w) => w.number)).toEqual([4]);
    expect(skip.map((s) => s.number)).toEqual([1, 2, 3]);
    expect(skip[0]!.reason).toBe('needs a person (human)');
  });

  it('skips an issue an open pull request already claims', () => {
    const { work, skip } = triage([issue(7, ['high']), issue(8, ['medium'])], [
      { number: 99, body: 'Some text.\n\nCloses #7' },
    ]);
    expect(work.map((w) => w.number)).toEqual([8]);
    expect(skip).toEqual([{ number: 7, title: 'issue 7', reason: 'in flight in #99' }]);
  });

  it('skips an issue that depends on one still open, and not on one that is closed', () => {
    const { work, skip } = triage(
      [issue(10, ['medium'], 'Depends on #11.'), issue(11, ['medium']), issue(12, ['medium'], 'Depends on #3.')],
      [],
    );
    expect(work.map((w) => w.number)).toEqual([11, 12]);
    expect(skip[0]!.reason).toBe('depends on open #11');
  });

  it('ranks a label named like an Object.prototype property as unranked, not NaN', () => {
    const { work } = triage(
      [issue(1, ['constructor']), issue(2, ['medium']), issue(3, ['toString', 'high'])],
      [],
    );
    expect(work.map((w) => w.number)).toEqual([3, 2, 1]);
    expect(work.map((w) => w.rank)).toEqual(['high', 'medium', 'unranked']);
  });

  it('works nothing when everything is skipped, rather than failing', () => {
    expect(triage([issue(1, ['human'])], []).work).toEqual([]);
    expect(triage([], []).work).toEqual([]);
  });
});

describe('the per-run ceiling', () => {
  const many = [1, 2, 3, 4, 5].map((n) => issue(n, ['medium']));

  it('takes at most MAX_ISSUES_PER_RUN, the highest ranked first', () => {
    const { work } = triage([...many, issue(9, ['critical'])], []);
    expect(work).toHaveLength(MAX_ISSUES_PER_RUN);
    expect(work[0]!.number).toBe(9);
  });

  it('defers the rest in order rather than dropping them', () => {
    const { work, deferred } = triage(many, []);
    expect([...work, ...deferred].map((w) => w.number)).toEqual([1, 2, 3, 4, 5]);
    expect(deferred.map((d) => d.number)).toEqual([4, 5]);
  });

  it('is three, the number docs/sops.md declares', () => {
    expect(MAX_ISSUES_PER_RUN).toBe(3);
  });
});

describe('render', () => {
  it('says when there is nothing to work, rather than printing an empty list', () => {
    expect(render(triage([issue(1, ['human'])], []))).toContain('nothing an agent may take on');
  });

  it('lists deferred work and warns when a listing was truncated', () => {
    const text = render(triage([1, 2, 3, 4].map((n) => issue(n, ['medium'])), []), { truncated: true });
    expect(text).toContain('Deferred to the next run');
    expect(text).toContain('#4 [medium]');
    expect(text).toContain('WARNING');
  });
});

describe('claimedIssues', () => {
  it('reads every closing and referencing keyword, case-insensitively', () => {
    const claimed = claimedIssues([
      { number: 1, body: 'closes #10, Fixes #11' },
      { number: 2, body: 'RESOLVES #12\nRefs #13' },
      { number: 3, body: 'mentions #14 in passing' },
    ]);
    expect([...claimed.entries()]).toEqual([
      [10, 1],
      [11, 1],
      [12, 2],
      [13, 2],
    ]);
  });
});

describe('openDependencies', () => {
  it('returns only the dependencies still open', () => {
    expect(openDependencies(issue(1, [], 'Depends on #2 and depends on #3'), new Set([2]))).toEqual([2]);
  });
});
