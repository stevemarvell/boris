import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MAX_RUNS, lastReviewed, type Job, type Run } from '../last-reviewed.mjs';

const run = (id: number, sha: string, status = 'completed'): Run => ({ id, head_sha: sha, status });
const job = (name: string, conclusion: string | null): Job => ({ name, conclusion });
const lookup = (table: Record<number, Job[]>) => (r: Run) => table[r.id as number];

describe('lastReviewed', () => {
  it('has nothing to say when no run exists: the initial review is not started', () => {
    expect(lastReviewed([], () => [])).toEqual({ state: 'none' });
    expect(lastReviewed(undefined, () => [])).toEqual({ state: 'none' });
  });

  it('takes the head of a run whose review job succeeded', () => {
    const runs = [run(1, 'aaa')];
    expect(lastReviewed(runs, lookup({ 1: [job('scope', 'success'), job('code review', 'success'), job('security review', 'skipped')] }))).toEqual({ state: 'reviewed', sha: 'aaa' });
    expect(lastReviewed(runs, lookup({ 1: [job('scope', 'success'), job('security review', 'success')] }))).toEqual({ state: 'reviewed', sha: 'aaa' });
  });

  it('skips a cancelled newest run and uses the one before it', () => {
    const runs = [run(2, 'bbb'), run(1, 'aaa')];
    const jobs = lookup({ 2: [job('scope', 'cancelled'), job('code review', 'cancelled')], 1: [job('code review', 'success')] });
    expect(lastReviewed(runs, jobs)).toEqual({ state: 'reviewed', sha: 'aaa' });
  });

  it('does not count a run that failed with no review, or one whose reviews were skipped', () => {
    const runs = [run(3, 'ccc'), run(2, 'bbb'), run(1, 'aaa')];
    const jobs = lookup({
      3: [job('scope', 'success'), job('code review', 'failure'), job('security review', 'failure')],
      2: [job('scope', 'success'), job('code review', 'skipped'), job('security review', 'skipped')],
      1: [job('scope', 'success'), job('code review', 'success')],
    });
    expect(lastReviewed(runs, jobs)).toEqual({ state: 'reviewed', sha: 'aaa' });
  });

  it('does not count a label-only run in which every job was skipped', () => {
    const runs = [run(2, 'bbb'), run(1, 'aaa')];
    const jobs = lookup({ 2: [job('scope', 'skipped'), job('code review', 'skipped'), job('security review', 'skipped')], 1: [job('security review', 'success')] });
    expect(lastReviewed(runs, jobs)).toEqual({ state: 'reviewed', sha: 'aaa' });
  });

  it('says none when every run failed, was skipped or was cancelled', () => {
    const runs = [run(2, 'bbb'), run(1, 'aaa')];
    const jobs = lookup({ 2: [job('code review', 'failure')], 1: [job('code review', 'cancelled'), job('security review', 'skipped')] });
    expect(lastReviewed(runs, jobs)).toEqual({ state: 'none' });
  });

  it('says pending when a newer run has not finished, so the driver waits', () => {
    const runs = [run(2, 'bbb', 'in_progress'), run(1, 'aaa')];
    expect(lastReviewed(runs, lookup({ 1: [job('code review', 'success')] })).state).toBe('pending');
    expect(lastReviewed([run(1, 'aaa', 'queued')], () => [])).toEqual({ state: 'pending' });
  });

  it('looks at no more than MAX_RUNS runs', () => {
    const runs = Array.from({ length: MAX_RUNS + 5 }, (_, i) => run(i, `s${i}`));
    const seen: number[] = [];
    lastReviewed(runs, (r) => {
      seen.push(r.id as number);
      return [];
    });
    expect(seen).toHaveLength(MAX_RUNS);
  });
});

describe('the last-reviewed CLI', () => {
  const cwd = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

  it('exits 2, not 3, when gh cannot run: an API error is not "no runs"', { timeout: 15_000 }, () => {
    const run = spawnSync(process.execPath, ['scripts/last-reviewed.mjs', 'some-branch'], {
      cwd,
      env: { PATH: '/nonexistent' },
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect(run.status).toBe(2);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain('gh failed');
  });

  it('exits 2 with a usage line when given no branch', { timeout: 15_000 }, () => {
    const run = spawnSync(process.execPath, ['scripts/last-reviewed.mjs'], { cwd, encoding: 'utf8', timeout: 10_000 });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('usage');
  });
});
