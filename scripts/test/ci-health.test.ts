import { describe, expect, it } from 'vitest';
import { ciDidNotRun } from '../ci-health.mjs';

const run = (seconds: number, extra: Record<string, unknown> = {}) => ({
  status: 'completed',
  conclusion: 'failure',
  started_at: '2026-11-11T10:00:00Z',
  completed_at: new Date(Date.parse('2026-11-11T10:00:00Z') + seconds * 1000).toISOString(),
  ...extra,
});

describe('ciDidNotRun', () => {
  it('is true when every check run failed in under 30 seconds', () => {
    expect(ciDidNotRun([run(3), run(10), run(29)])).toBe(true);
  });
  it('is false when one failure ran for 30 seconds or more', () => {
    expect(ciDidNotRun([run(3), run(30)])).toBe(false);
    expect(ciDidNotRun([run(3), run(240)])).toBe(false);
  });
  it('is false when one check run succeeded', () => {
    expect(ciDidNotRun([run(3), run(5, { conclusion: 'success' })])).toBe(false);
  });
  it('is false for an empty or missing list', () => {
    expect(ciDidNotRun([])).toBe(false);
    expect(ciDidNotRun(null)).toBe(false);
    expect(ciDidNotRun(undefined)).toBe(false);
  });
  it('is false while a check run is still in progress', () => {
    expect(ciDidNotRun([run(3), { status: 'in_progress', conclusion: null, started_at: '2026-11-11T10:00:00Z', completed_at: null }])).toBe(false);
  });
  it('is false for a timestamp it cannot read', () => {
    expect(ciDidNotRun([run(3, { completed_at: null })])).toBe(false);
  });
});
