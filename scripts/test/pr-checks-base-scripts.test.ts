import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// #359: `pr checks` holds `pull-requests: write` while it runs, so no script
// from the pull request's own checkout may execute in it. Both scripts run
// from `base-scripts/`, a separate checkout of the base commit.
const FILE = join(dirname(fileURLToPath(import.meta.url)), '../../.github/workflows/pr-checks.yml');

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, unknown>;
  with?: Record<string, unknown>;
}

const doc = parse(readFileSync(FILE, 'utf8')) as { jobs: { checks: { steps: Step[] } } };
const steps = doc.jobs.checks.steps;
const holdsToken = (s: Step) => JSON.stringify(s.env ?? {}).match(/GH_TOKEN|github\.token|secrets\./) !== null;
// A `node scripts/...` path is resolved against the PR checkout (the cwd).
const runsBranchScript = (s: Step) => /\bnode\s+(\.\/)?scripts\//.test(s.run ?? '');

describe('pr-checks.yml runs only base-branch scripts', () => {
  it('has steps to scan, and token-holding ones', () => {
    expect(steps.length).toBeGreaterThan(3);
    expect(steps.filter(holdsToken).length).toBeGreaterThan(0);
  });

  it('no step holding the token runs a node script from the PR checkout', () => {
    const bad = steps.filter((s) => holdsToken(s) && runsBranchScript(s)).map((s) => s.name);
    expect(bad).toEqual([]);
  });

  it('no step at all runs a node script from the PR checkout', () => {
    // The census holds no token, but it runs first and could reach later steps.
    expect(steps.filter(runsBranchScript).map((s) => s.name ?? s.run)).toEqual([]);
  });

  it('both scripts run from base-scripts/', () => {
    const runs = steps.map((s) => s.run ?? '').join('\n');
    expect(runs).toMatch(/node base-scripts\/scripts\/test-census\.mjs/);
    expect(runs).toMatch(/node base-scripts\/scripts\/pr-contention\.mjs/);
  });

  it('base-scripts is a separate, credential-less checkout of the base commit', () => {
    const base = steps.find((s) => s.uses?.startsWith('actions/checkout@') && s.with?.path === 'base-scripts');
    expect(base).toBeDefined();
    expect(base?.with?.['persist-credentials']).toBe(false);
    expect(String(base?.with?.ref)).toContain('github.event.pull_request.base.sha');
  });

  it('the log names the base sha the scripts came from', () => {
    const log = steps.find((s) => /rev-parse HEAD/.test(s.run ?? '') && /base-scripts/.test(s.run ?? ''));
    expect(log).toBeDefined();
  });
});
