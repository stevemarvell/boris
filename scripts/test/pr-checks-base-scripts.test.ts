import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// #359, #371: `pr checks` holds `pull-requests: write` while it runs, so no
// script from the pull request's own checkout may execute in it. Both scripts
// run from `base-scripts/`, a separate checkout of the base commit.
//
// The check is an allowlist of what a step may run, not a search for one
// spelling of branch code: `node scripts/x.mjs` is one of a dozen ways to run
// the checkout, and a denylist loses to the next spelling. Anything not named
// here is rejected, naming the step.
const FILE = join(dirname(fileURLToPath(import.meta.url)), '../../.github/workflows/pr-checks.yml');

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, unknown>;
  with?: Record<string, unknown>;
}
interface Workflow {
  env?: Record<string, unknown>;
  jobs: { checks: { env?: Record<string, unknown>; steps: Step[] } };
}

const ALLOWED_COMMANDS = new Set(['gh', 'git', 'echo', 'cat', 'printf', 'base64', 'test', '[', 'set', 'export']);
const SHELL_KEYWORDS = new Set(['{', '}', 'if', 'then', 'else', 'elif', 'fi', 'do', 'done', '!']);
const BASE_SCRIPTS = 'base-scripts/scripts/';
const TOKEN = /GH_TOKEN|github\.token|secrets\./;

const load = (text: string) => parse(text) as Workflow;
const label = (s: Step) => s.name ?? s.uses ?? (s.run ?? '').trim().split('\n')[0] ?? '';
const unquote = (w: string) => w.replace(/^["']+|["']+$/g, '');

/** The commands of a `run:` block, one argv each. */
function commands(run: string): string[][] {
  const text = run
    .replace(/\\\n/g, ' ')
    .replace(/\$\{\{[\s\S]*?\}\}/g, 'EXPR')
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n');
  const out: string[][] = [];
  for (let seg of text.split(/\n|;|&&|\|\||\||\$\(|`|\(|\)|\{\s|\s\}/)) {
    seg = seg.trim().replace(/^["']+\s*/, '');
    // Leading VAR=value assignments belong to the command after them.
    seg = seg.replace(/^([A-Za-z_]\w*=("[^"]*"?|'[^']*'?|\S*)\s*)+/, '');
    let words = seg.split(/\s+/).filter(Boolean);
    while (words.length && SHELL_KEYWORDS.has(words[0] ?? '')) words = words.slice(1);
    if (words.length && /^[<>]/.test(words[0] ?? '')) words = [];
    if (words.length) out.push(words);
  }
  return out;
}

/** Why a `run:` command is not allowed, or null when it is. */
function rejectCommand(argv: string[]): string | null {
  const cmd = unquote(argv[0] ?? '');
  if (cmd === 'node') {
    const script = argv.slice(1).map(unquote).find((a) => !a.startsWith('-'));
    if (script === undefined || !script.startsWith(BASE_SCRIPTS) || script.includes('..')) {
      return `node must run a script under ${BASE_SCRIPTS}, got ${script ?? 'none'}`;
    }
    return null;
  }
  return ALLOWED_COMMANDS.has(cmd) ? null : `command not allowed: ${argv.join(' ')}`;
}

/** Every step that runs something the job does not allow, with the reason. */
function violations(text: string): string[] {
  const out: string[] = [];
  for (const s of load(text).jobs.checks.steps) {
    if (s.uses && (s.uses.startsWith('.') || s.uses.startsWith('docker://'))) {
      out.push(`${label(s)}: uses ${s.uses} runs code from the pull request`);
    }
    for (const argv of commands(s.run ?? '')) {
      const why = rejectCommand(argv);
      if (why) out.push(`${label(s)}: ${why}`);
    }
  }
  return out;
}

/** Steps holding the token: it appears in their own env, with or run, or in a job- or workflow-level env. */
function tokenHolders(text: string): string[] {
  const wf = load(text);
  const inherited = TOKEN.test(JSON.stringify(wf.env ?? {}) + JSON.stringify(wf.jobs.checks.env ?? {}));
  return wf.jobs.checks.steps.filter((s) => inherited || TOKEN.test(JSON.stringify(s))).map(label);
}

/** What is wrong with the `base-scripts` checkout, or [] when it is sound. */
function checkoutProblems(text: string): string[] {
  const steps = load(text).jobs.checks.steps;
  const at = steps.findIndex((s) => s.uses?.startsWith('actions/checkout@') && s.with?.path === 'base-scripts');
  if (at < 0) return ['no base-scripts checkout'];
  const w = steps[at]?.with ?? {};
  const out: string[] = [];
  if (w['persist-credentials'] !== false) out.push('persist-credentials is not false');
  const ref = String(w.ref);
  if (!ref.includes('github.event.pull_request.base.sha')) out.push('ref lacks the base sha');
  if (!ref.includes('|| github.sha')) out.push('ref lacks the `|| github.sha` fallback');
  if (w['sparse-checkout'] !== 'scripts') out.push('sparse-checkout is not `scripts`');
  const first = steps.findIndex((s) => /base-scripts\//.test(s.run ?? ''));
  if (first >= 0 && first < at) out.push(`step "${label(steps[first] as Step)}" invokes base-scripts/ before the checkout`);
  return out;
}

const real = readFileSync(FILE, 'utf8');
/** The real workflow with one exact fragment replaced; throws if it is not there. */
const mutate = (from: string, to: string) => {
  if (!real.includes(from)) throw new Error(`fixture drifted: ${from}`);
  return real.replace(from, to);
};
const CENSUS = 'node base-scripts/scripts/test-census.mjs';
const CENSUS_STEP = 'Count the tests on both sides';
const SETUP_NODE = 'actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1';

describe('pr-checks.yml runs only what the allowlist names', () => {
  it('the real workflow is clean, has steps to scan and token-holding ones', () => {
    expect(load(real).jobs.checks.steps.length).toBeGreaterThan(3);
    expect(tokenHolders(real).length).toBeGreaterThan(0);
    expect(violations(real)).toEqual([]);
    expect(checkoutProblems(real)).toEqual([]);
  });

  it('both scripts run from base-scripts/', () => {
    const runs = load(real).jobs.checks.steps.map((s) => s.run ?? '').join('\n');
    expect(runs).toMatch(/node base-scripts\/scripts\/test-census\.mjs/);
    expect(runs).toMatch(/node base-scripts\/scripts\/pr-contention\.mjs/);
  });

  it('the log names the base sha the scripts came from', () => {
    const log = load(real).jobs.checks.steps.find((s) => /rev-parse HEAD/.test(s.run ?? '') && /base-scripts/.test(s.run ?? ''));
    expect(log).toBeDefined();
  });

  it('rejects node with a flag before a branch script', () => {
    const v = violations(mutate(CENSUS, 'node --no-warnings scripts/test-census.mjs'));
    expect(v.join('\n')).toContain(`${CENSUS_STEP}: node must run a script under`);
  });

  it('rejects a quoted branch script', () => {
    const v = violations(mutate(CENSUS, 'node "scripts/test-census.mjs"'));
    expect(v.join('\n')).toContain(`${CENSUS_STEP}: node must run`);
  });

  it('rejects a branch script reached through $PWD', () => {
    const v = violations(mutate(CENSUS, 'node $PWD/scripts/test-census.mjs'));
    expect(v.join('\n')).toContain(`${CENSUS_STEP}: node must run`);
  });

  it('rejects a flag that loads branch code ahead of a base script', () => {
    const v = violations(mutate(CENSUS, `node --require ./evil.js ${CENSUS.slice(5)}`));
    expect(v.join('\n')).toContain(`${CENSUS_STEP}: node must run`);
  });

  it('rejects a base-scripts path that climbs out with ..', () => {
    const v = violations(mutate(CENSUS, 'node base-scripts/scripts/../../scripts/test-census.mjs'));
    expect(v.join('\n')).toContain(`${CENSUS_STEP}: node must run`);
  });

  it('rejects bash on a repo script', () => {
    const v = violations(mutate(CENSUS, 'bash scripts/x.sh'));
    expect(v.join('\n')).toContain(`${CENSUS_STEP}: command not allowed: bash scripts/x.sh`);
  });

  it('rejects npm run', () => {
    const v = violations(mutate(CENSUS, 'npm run x'));
    expect(v.join('\n')).toContain(`${CENSUS_STEP}: command not allowed: npm run x`);
  });

  it('rejects npx', () => {
    const v = violations(mutate(CENSUS, 'npx x'));
    expect(v.join('\n')).toContain(`${CENSUS_STEP}: command not allowed: npx x`);
  });

  it('rejects a local action', () => {
    const v = violations(mutate(`- uses: ${SETUP_NODE} # v7.1.0`, '- uses: ./.github/actions/x'));
    expect(v.join('\n')).toContain('uses ./.github/actions/x');
  });

  it('rejects a branch command hidden after && among allowed ones', () => {
    const v = violations(mutate('run: echo "pr checks scripts', 'run: echo hi && npm run x && echo "pr checks scripts'));
    expect(v.join('\n')).toContain('command not allowed: npm run x');
  });

  it('counts a token interpolated into a run: as held', () => {
    const t = mutate('run: echo "pr checks scripts', 'run: echo "${{ github.token }}" "pr checks scripts');
    expect(tokenHolders(t)).toContain('Say which commit the scripts came from');
    expect(tokenHolders(real)).not.toContain('Say which commit the scripts came from');
  });

  it('counts secrets.* interpolated into with: as held', () => {
    const t = mutate('node-version: 22', 'node-version: ${{ secrets.X }}');
    expect(tokenHolders(t)).toContain(SETUP_NODE);
    expect(tokenHolders(real)).not.toContain(SETUP_NODE);
  });

  it('counts a job-level env holding the token as every step holding it', () => {
    const t = mutate('    permissions:\n', '    env:\n      T: ${{ github.token }}\n    permissions:\n');
    expect(tokenHolders(t)).toEqual(load(t).jobs.checks.steps.map(label));
  });

  it('asserts the || github.sha fallback', () => {
    const t = mutate('ref: ${{ github.event.pull_request.base.sha || github.sha }}', 'ref: ${{ github.event.pull_request.base.sha }}');
    expect(checkoutProblems(t)).toContain('ref lacks the `|| github.sha` fallback');
  });

  it('asserts sparse-checkout: scripts', () => {
    const t = mutate('sparse-checkout: scripts', 'sparse-checkout: .');
    expect(checkoutProblems(t)).toContain('sparse-checkout is not `scripts`');
  });

  it('asserts the checkout comes before the first step invoking base-scripts/', () => {
    const early = '      - name: Early\n        run: node base-scripts/scripts/test-census.mjs\n\n';
    const t = mutate('      # The scripts that run in this job come from here', `${early}      # The scripts that run in this job come from here`);
    expect(checkoutProblems(t)).toContain('step "Early" invokes base-scripts/ before the checkout');
  });

  it('asserts the checkout is credential-less', () => {
    const t = mutate('sparse-checkout: scripts\n          persist-credentials: false', 'sparse-checkout: scripts');
    expect(checkoutProblems(t)).toContain('persist-credentials is not false');
  });
});
