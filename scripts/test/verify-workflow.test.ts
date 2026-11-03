import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cli, loadProject, validate, type Project } from '../project.mjs';

// What verify.yml spends minutes on is decided by project.json (#254): the uv
// and Playwright steps run only for a product with an app of that toolchain.
// These read the workflow file itself, then evaluate its `if:` conditions
// against the lines `project.mjs toolchains` writes, so what is checked is
// the file CI runs, not a copy of its logic.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

interface Step {
  text: string;
  id?: string;
  condition?: string;
}

/** The steps of verify.yml's one job, each as its raw text with its id and `if:` pulled out. */
function steps(): Step[] {
  const text = readFileSync(join(REPO_ROOT, '.github/workflows/verify.yml'), 'utf8');
  const body = text.slice(text.indexOf('    steps:\n') + '    steps:\n'.length);
  // A step starts at a six-space "- " line; comment lines between steps are not part of one.
  return body
    .split(/^(?= {6}- )/m)
    .filter((chunk) => chunk.startsWith('      - '))
    .map((chunk) => ({
      text: chunk,
      id: chunk.match(/^ {6}(?:- | {2})id: (\S+)/m)?.[1],
      condition: chunk.match(/^ {6}(?:- | {2})if: (.+)$/m)?.[1],
    }));
}

/**
 * Whether `step` runs, given the toolchain outputs and whether an earlier step
 * failed. A step with no status function in its `if:` carries GitHub's implicit
 * `success()`, so it does not run after a failure.
 */
function runs(step: Step, outputs: Record<string, string>, failed: boolean): boolean {
  const terms = (step.condition ?? '').split('&&').map((term) => term.trim()).filter(Boolean);
  let ok = terms.includes('failure()') ? failed : !failed;
  for (const term of terms) {
    if (term === 'failure()') continue;
    const m = term.match(/^steps\.toolchains\.outputs\.(\w+) == 'true'$/);
    if (!m) throw new Error(`verify.yml: an if: this test does not understand: ${term}`);
    ok = ok && outputs[m[1]!] === 'true';
  }
  return ok;
}

const outputsFor = (project: Project) => Object.fromEntries(cli(['toolchains'], project).map((l) => l.split('=') as [string, string]));
const named = (what: RegExp) => {
  const found = steps().filter((s) => what.test(s.text));
  expect(found, `a step matching ${what}`).toHaveLength(1);
  return found[0]!;
};

// catalogue.json is in the base only, so it marks the base from a product built
// from it. The base has both a node and a python app and must run every step; a
// product holds what it was assembled with, and its steps run only for those (#254, #281).
const IN_BASE = existsSync(join(REPO_ROOT, 'catalogue.json'));
const own = () => outputsFor(loadProject());
const hasBoth = () => own().node === 'true' && own().python === 'true';

const engineOnly = () => validate({ name: 'thing', engine: { commit: 'a'.repeat(40) }, apps: {} });
const only = (toolchain: 'node' | 'python'): Project => {
  const base = loadProject();
  return { ...base, apps: Object.fromEntries(Object.entries(base.apps).filter(([, app]) => app.toolchain === toolchain)) };
};

describe('verify.yml', () => {
  const uv = () => named(/astral-sh\/setup-uv/);
  const sync = () => named(/uv sync/);
  const playwright = () => named(/playwright install/);
  const report = () => named(/upload-artifact/);

  it('always runs checkout, setup-node, npm ci and verify, whatever the product holds', () => {
    for (const what of [/actions\/checkout/, /actions\/setup-node/, /run: npm ci/, /run: npm run verify/]) {
      expect(named(what).condition, String(what)).toBeUndefined();
    }
  });

  it('decides in one early step, after node is set up and before anything it gates', () => {
    const all = steps();
    const at = all.findIndex((s) => s.id === 'toolchains');
    expect(at).toBeGreaterThan(all.findIndex((s) => /actions\/setup-node/.test(s.text)));
    expect(all[at]!.text).toContain('node scripts/project.mjs toolchains >> "$GITHUB_OUTPUT"');
    for (const gated of [uv(), sync(), playwright(), report()]) expect(all.findIndex((s) => s.text === gated.text)).toBeGreaterThan(at);
  });

  it("keeps every step in the base itself, which has both a node and a python app", () => {
    const outputs = outputsFor(loadProject());
    // In the base, both toolchains are required; in a product, hold it to what it has.
    if (IN_BASE) expect(outputs).toEqual({ node: 'true', python: 'true' });
    else if (!hasBoth()) {
      // A product with fewer toolchains skips the steps for the ones it lacks.
      expect(runs(uv(), outputs, false)).toBe(outputs.python === 'true');
      expect(runs(playwright(), outputs, false)).toBe(outputs.node === 'true');
      return;
    }
    // Every step but the failure-only report runs on a green build.
    for (const step of steps().filter((s) => s.text !== report().text)) expect(runs(step, outputs, false), step.text).toBe(true);
    expect(runs(report(), outputs, true)).toBe(true);
  });

  it('skips uv, the Python sync, Playwright and its report in an engine-only product', () => {
    const outputs = outputsFor(engineOnly());
    expect(outputs).toEqual({ node: 'false', python: 'false' });
    for (const step of [uv(), sync(), playwright()]) expect(runs(step, outputs, false), step.text).toBe(false);
    expect(runs(report(), outputs, true)).toBe(false);
    for (const step of [named(/actions\/checkout/), named(/actions\/setup-node/), named(/run: npm ci/), named(/run: npm run verify/)]) {
      expect(runs(step, outputs, false), step.text).toBe(true);
    }
  });

  // Needs one app of each toolchain to subset from.
  it.skipIf(!hasBoth())('skips only Playwright and its report with no node app, and only uv with no python app', () => {
    const pythonOnly = outputsFor(only('python'));
    expect([uv(), sync(), playwright()].map((s) => runs(s, pythonOnly, false))).toEqual([true, true, false]);
    expect(runs(report(), pythonOnly, true)).toBe(false);

    const nodeOnly = outputsFor(only('node'));
    expect([uv(), sync(), playwright()].map((s) => runs(s, nodeOnly, false))).toEqual([false, false, true]);
    expect(runs(report(), nodeOnly, true)).toBe(true);
  });

  it('uploads the report only on failure, as before', () => {
    expect(report().condition).toContain('failure()');
    expect(runs(report(), { node: 'true', python: 'true' }, false)).toBe(false);
  });

  // Timeout: spawns bash on the workflow step (37 ms quiet); 15 s.
  it('writes the outputs the workflow reads, when its step is run as written, against this repository', { timeout: 15_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'gh-output-'));
    try {
      const out = join(dir, 'output');
      const run = steps().find((s) => s.id === 'toolchains')!.text.match(/run: (.+)$/m)![1]!;
      const result = spawnSync('bash', ['-ec', run], { cwd: REPO_ROOT, env: { ...process.env, GITHUB_OUTPUT: out }, encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
      const o = own();
      expect(readFileSync(out, 'utf8')).toBe(`node=${o.node}\npython=${o.python}\n`);
      if (IN_BASE) expect(o).toEqual({ node: 'true', python: 'true' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
