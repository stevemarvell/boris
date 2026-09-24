import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { deployed, loadProject, type Project } from '../project.mjs';
import { GATE_ATTEMPTS, appUrls, smoke, waitForCommit, type FetchJson, type Git } from '../smoke.mjs';

const project = (): Project => ({
  name: 'thing',
  vercel: { team: 't' },
  apps: {
    back: {
      path: 'apps/back',
      toolchain: 'python',
      reads: ['apps/back'],
      vercelProject: 'thing-back',
      url: 'https://back.example',
      commitEndpoint: '/health',
      smoke: 'apps/back/smoke.sh',
    },
    front: {
      path: 'apps/front',
      toolchain: 'node',
      reads: ['apps/front'],
      vercelProject: 'thing-front',
      url: 'https://front.example',
      commitEndpoint: '/version.json',
    },
    tool: { path: 'apps/tool', toolchain: 'python', reads: ['apps/tool'] },
  },
});

// Each URL answers from a queue of commits; the last one repeats.
function server(answers: Record<string, (string | Error)[]>) {
  const asked: string[] = [];
  const fetchJson: FetchJson = async (url) => {
    asked.push(url);
    const queue = answers[url] ?? [new Error('404')];
    const next = queue.length > 1 ? queue.shift()! : queue[0]!;
    if (next instanceof Error) throw next;
    return { commit: next };
  };
  return { fetchJson, asked };
}

const noSleep = async () => {};
const quiet = () => {};
const gitSays = (status: number): Git => () => ({ status });

describe('appUrls', () => {
  it('names each deployed app upper-cased, and leaves undeployed ones out', () => {
    expect(appUrls(project())).toEqual({ BACK: 'https://back.example', FRONT: 'https://front.example' });
  });
});

describe('waitForCommit', () => {
  const base = { project: project(), name: 'back', sha: 'new', sleep: noSleep, log: quiet };

  it('passes when the app reports this commit', async () => {
    const { fetchJson } = server({ 'https://back.example/health': ['new'] });
    expect((await waitForCommit({ ...base, fetchJson, git: gitSays(1) })).ok).toBe(true);
  });

  it('passes a skipped build: an older commit whose inputs git says match', async () => {
    const calls: string[][] = [];
    const git: Git = (args) => {
      calls.push(args);
      return { status: 0 };
    };
    const { fetchJson } = server({ 'https://back.example/health': ['old'] });
    const result = await waitForCommit({ ...base, fetchJson, git });
    expect(result.ok).toBe(true);
    expect(result.reason).toMatch(/skipped/);
    // Asked with the ignore step's own pathspecs, so the two cannot disagree.
    expect(calls[0]!.slice(0, 5)).toEqual(['diff', '--quiet', 'old', 'new', '--']);
    expect(calls[0]).toContain('apps/back');
  });

  it('waits through a stale build and a cold start until the new one appears', async () => {
    const { fetchJson, asked } = server({ 'https://back.example/health': ['old', new Error('502'), 'new'] });
    const result = await waitForCommit({ ...base, fetchJson, git: gitSays(1) });
    expect(result.ok).toBe(true);
    expect(asked).toHaveLength(3);
  });

  it('fails at the ceiling rather than waiting forever', async () => {
    const { fetchJson, asked } = server({ 'https://back.example/health': ['old'] });
    const result = await waitForCommit({ ...base, fetchJson, git: gitSays(1), attempts: 3 });
    expect(result.ok).toBe(false);
    expect(asked).toHaveLength(3);
    expect(result.reason).toMatch(/serving an older build/);
  });

  it('declares a ceiling of forty attempts', () => {
    expect(GATE_ATTEMPTS).toBe(40);
  });
});

describe('smoke', () => {
  const answers = () => ({ 'https://back.example/health': ['new'], 'https://front.example/version.json': ['new'] });

  it('gates every deployed app and runs the checks each one owns, with every URL', async () => {
    const ran: [string, Record<string, string>][] = [];
    const { fetchJson, asked } = server(answers());
    const result = await smoke({
      project: project(),
      sha: 'new',
      fetchJson,
      git: gitSays(1),
      sleep: noSleep,
      run: (script, urls) => (ran.push([script, urls]), 0),
      log: quiet,
    });
    expect(result.ok).toBe(true);
    expect(asked).toEqual(['https://back.example/health', 'https://front.example/version.json']);
    expect(ran).toEqual([['apps/back/smoke.sh', { BACK: 'https://back.example', FRONT: 'https://front.example' }]]);
  });

  it("stops at the first failure: a failing app's checks end the run", async () => {
    const { fetchJson, asked } = server(answers());
    const result = await smoke({
      project: project(),
      sha: 'new',
      fetchJson,
      git: gitSays(1),
      sleep: noSleep,
      run: () => 1,
      log: quiet,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/apps\/back\/smoke\.sh failed/);
    expect(asked).toEqual(['https://back.example/health']);
  });

  it('does not run an app whose gate failed', async () => {
    let ran = 0;
    const { fetchJson } = server({ 'https://back.example/health': ['old'] });
    const result = await smoke({
      project: project(),
      sha: 'new',
      fetchJson,
      git: gitSays(1),
      sleep: noSleep,
      run: () => (ran++, 0),
      log: quiet,
    });
    expect(result.ok).toBe(false);
    expect(ran).toBe(0);
  });

  it('refuses to run without a commit to check', async () => {
    const { fetchJson } = server(answers());
    const result = await smoke({ project: project(), sha: undefined, fetchJson, git: gitSays(0), sleep: noSleep, run: () => 0, log: quiet });
    expect(result.ok).toBe(false);
  });
});

describe("each app's smoke script", () => {
  // The checks are written for a step shell of `bash -e`. Under
  // pipefail, `printf "$page" | grep -q …` fails on a match — grep exits
  // early and printf dies of SIGPIPE — so every retry read "not yet" until the
  // ceiling. Linux delivers that SIGPIPE and Git Bash on Windows does not, so
  // a local run cannot catch it; this does, on every platform.
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

  it('runs with the step shell\'s options: set -e, never pipefail', () => {
    const scripts = deployed(loadProject()).flatMap(([, app]) => (app.smoke ? [app.smoke] : []));
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) {
      const code = readFileSync(join(ROOT, script), 'utf8')
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('#'))
        .join('\n');
      expect(code, script).toMatch(/^set -e$/m);
      expect(code, script).not.toMatch(/pipefail|set -[a-z]*o /);
    }
  });
});
