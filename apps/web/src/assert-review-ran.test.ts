import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UNREADABLE, readExecution, reviewVerdict } from '../../../scripts/assert-review-ran.mjs';

const finished = (extra: Record<string, unknown> = {}) => [
  { type: 'system', subtype: 'init' },
  { type: 'result', subtype: 'success', is_error: false, num_turns: 11, ...extra },
];

describe('reviewVerdict', () => {
  it('passes a session that reached a verdict', () => {
    expect(reviewVerdict({ conclusion: 'success', execution: finished() }).ok).toBe(true);
  });

  it('fails when there is no execution log at all', () => {
    // The workflow-validation skip: the action exits before starting a session
    // and leaves the job green. Run 34814234791 did exactly this — sixteen
    // seconds, success, no review — on a pull request that changed CI.
    const verdict = reviewVerdict({ kind: 'security', conclusion: '', execution: null });
    expect(verdict.ok).toBe(false);
    expect(verdict.headline).toContain('security');
    expect(verdict.detail).toContain('.github/workflows/');
  });

  it('fails a session that ended with is_error', () => {
    // Three of the twenty runs before this script existed did, and the job log
    // reads "No buffered inline comments" — nothing reached the pull request.
    const verdict = reviewVerdict({ execution: finished({ is_error: true }) });
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain('unreviewed');
  });

  it('fails a log that never reached a result', () => {
    const verdict = reviewVerdict({ execution: [{ type: 'system', subtype: 'init' }] });
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain('cut off');
  });

  it('fails when the action itself did not call it a success', () => {
    const verdict = reviewVerdict({ conclusion: 'failure', execution: finished() });
    expect(verdict.ok).toBe(false);
    expect(verdict.headline).toContain('failure');
  });

  it('never leaks the execution log into what it prints', () => {
    // The log carries tool output, and this job's environment holds the Claude
    // OAuth token and the Grafana credentials.
    const secret = 'sk-ant-oat-notarealtoken';
    const verdict = reviewVerdict({
      execution: finished({ is_error: true, result: `failed while reading ${secret}` }),
    });
    expect(`${verdict.headline} ${verdict.detail}`).not.toContain(secret);
  });

  it('defaults to failing rather than to passing', () => {
    // Called with nothing at all — no log, no conclusion — it must not report
    // that a review happened.
    expect(reviewVerdict().ok).toBe(false);
  });
});

describe('readExecution', () => {
  it('returns null for a path that is empty or missing', () => {
    expect(readExecution('')).toBeNull();
    expect(readExecution('/no/such/claude-execution-output.json')).toBeNull();
  });

  it('separates a log that will not parse from a log that is not there', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'review-')), 'claude-execution-output.json');
    writeFileSync(path, 'Exiting due to workflow validation skip');

    // Both fail the job, but not for the same reason, and the reader is sent
    // to a different place by each.
    expect(readExecution(path)).toBe(UNREADABLE);

    const unreadable = reviewVerdict({ execution: UNREADABLE });
    const absent = reviewVerdict({ execution: null });
    expect(unreadable.ok).toBe(false);
    expect(absent.ok).toBe(false);
    expect(unreadable.headline).not.toBe(absent.headline);
    // The absent case blames the workflow-file rule. The unparseable one must
    // not, because that is a different failure with a different fix.
    expect(unreadable.detail).not.toMatch(/byte-identical/);
    expect(absent.detail).toMatch(/byte-identical/);
  });
});
