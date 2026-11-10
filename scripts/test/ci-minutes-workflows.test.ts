import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../labels.mjs';

// The Actions-minutes cuts are about which events start which jobs, and a
// trigger that is silently wrong costs either money or a check that never runs.
// These read the workflow files CI runs and pin the triggers and structure
// that the cuts rely on.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (name: string) => readFileSync(join(REPO_ROOT, '.github/workflows', name), 'utf8');

/** The text of the top-level `on:` block. */
function onBlock(text: string): string {
  const start = text.search(/^on:\n/m);
  const rest = text.slice(start + 4);
  const end = rest.search(/^\S/m);
  return rest.slice(0, end === -1 ? undefined : end);
}

/** The event types listed under one trigger, e.g. `types: [opened, edited]`. */
function types(text: string, event: string): string[] {
  const block = onBlock(text);
  const m = block.match(new RegExp(`^ {2}${event}:\\n {4}types: \\[([^\\]]*)\\]`, 'm'));
  return m ? m[1]!.split(',').map((t) => t.trim()) : [];
}

/** The text of one job. */
function job(text: string, name: string): string {
  const header = `\n  ${name}:\n`;
  const start = text.indexOf(header);
  expect(start, `job ${name}`).toBeGreaterThan(-1);
  const rest = text.slice(start + header.length);
  const next = rest.search(/^ {2}[a-z-]+:\n/m);
  return rest.slice(0, next === -1 ? undefined : next);
}

describe('verify.yml', () => {
  const text = read('verify.yml');

  it('runs on pull requests and by hand, and not on a push to develop', () => {
    const on = onBlock(text);
    expect(on).toMatch(/^ {2}pull_request:/m);
    expect(on).toMatch(/^ {2}workflow_dispatch:/m);
    expect(on).not.toMatch(/^ {2}push:/m);
  });

  it('does not run on pull request body edits: only the census wants those', () => {
    expect(onBlock(text)).not.toContain('edited');
  });
});

describe('smoke.yml', () => {
  it('still runs on every push to develop', () => {
    expect(onBlock(read('smoke.yml'))).toMatch(/^ {2}push:\n {4}branches: \[develop\]/m);
  });
});

describe('pr-checks.yml, the census and contention in one job', () => {
  const text = read('pr-checks.yml');

  it('replaces the two workflows it folds, so neither also runs', () => {
    expect(existsSync(join(REPO_ROOT, '.github/workflows/test-census.yml'))).toBe(false);
    expect(existsSync(join(REPO_ROOT, '.github/workflows/contention.yml'))).toBe(false);
  });

  it('has exactly one job, so the two checks bill one minute', () => {
    const jobs = text.slice(text.search(/^jobs:\n/m)).match(/^ {2}[a-z-]+:\n/gm) ?? [];
    expect(jobs).toHaveLength(1);
  });

  it('still re-runs on a body edit, which is how a Removes tests: line is read', () => {
    expect(types(text, 'pull_request')).toEqual(
      expect.arrayContaining(['opened', 'synchronize', 'reopened', 'ready_for_review', 'edited']),
    );
  });

  it('keeps the push to develop, the only thing that tells an open pull request a merge broke it', () => {
    expect(onBlock(text)).toMatch(/^ {2}push:\n {4}branches: \[develop\]/m);
  });

  it('runs the census on pull requests only, since a push has no base and head', () => {
    const census = text.slice(text.indexOf('- name: Count the tests on both sides'));
    expect(census.slice(0, census.indexOf('\n      - ')) ).toContain("if: github.event_name == 'pull_request'");
    expect(text).toContain('node scripts/test-census.mjs');
  });

  it('runs every contention step even when the census failed, and not on an edit', () => {
    for (const name of ['List the open pull requests', 'Fetch the heads being compared', 'Say what collides with what']) {
      const at = text.indexOf(`- name: ${name}`);
      expect(at, name).toBeGreaterThan(-1);
      const step = text.slice(at, text.indexOf('\n      - ', at + 1) === -1 ? undefined : text.indexOf('\n      - ', at + 1));
      expect(step, name).toContain("if: ${{ !cancelled() && github.event.action != 'edited' }}");
    }
    expect(text).toContain('node scripts/pr-contention.mjs');
  });

  it('groups per ref and cancels a superseded run, as the census did', () => {
    expect(text).toMatch(/concurrency:\n {2}group: pr-checks-\$\{\{ github\.ref \}\}\n {2}cancel-in-progress: true/);
  });

  it('can write comments and nothing wider than the old contention job', () => {
    expect(job(text, 'checks')).toMatch(/permissions:\n {6}contents: read\n {6}pull-requests: write\n/);
  });
});

describe('claude-code-review.yml, once per pull request (cut 3)', () => {
  const text = read('claude-code-review.yml');

  it('no longer re-runs on every push', () => {
    const t = types(text, 'pull_request');
    expect(t).not.toContain('synchronize');
    expect(t).toEqual(expect.arrayContaining(['opened', 'reopened', 'ready_for_review', 'labeled']));
  });

  it('starts the scope job, and so the reviews, for the re-review label and no other', () => {
    const scope = job(text, 'scope');
    expect(scope).toContain("if: github.event.action != 'labeled' || github.event.label.name == 're-review'");
  });

  it('keeps both reviews behind scope, so a skipped scope skips them', () => {
    for (const name of ['code-review', 'security-review']) {
      expect(job(text, name), name).toMatch(/^ {4}needs: scope$/m);
    }
  });

  it('gives a run for some other label its own concurrency group, so it cannot cancel a review', () => {
    expect(text).toContain(
      "github.event.action == 'labeled' && github.event.label.name != 're-review' && github.run_id || 'review'",
    );
    expect(text).toMatch(/cancel-in-progress: true/);
  });

  it('removes the label at the end, after both reviews, whatever they concluded', () => {
    const clear = job(text, 'clear-re-review');
    expect(clear).toMatch(/needs: \[scope, code-review, security-review\]/);
    expect(clear).toContain("if: always() && github.event.action == 'labeled' && github.event.label.name == 're-review'");
    expect(clear).toContain('-X DELETE');
    expect(clear).toContain('labels/re-review');
    // It writes labels only: no secret, no checkout of the pull request.
    expect(clear).not.toContain('secrets.');
    expect(clear).not.toContain('actions/checkout');
  });

  it('names a label that labels.json defines, so scripts/labels.mjs creates it', () => {
    const names = loadManifest().map((l) => l.name);
    expect(names).toContain('re-review');
    expect(text).toContain("'re-review'");
    const label = loadManifest().find((l) => l.name === 're-review');
    expect(label?.description.length).toBeLessThanOrEqual(100);
  });
});
