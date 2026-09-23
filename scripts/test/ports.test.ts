import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ports } from '../ports.mjs';

const WORKTREE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('ports', () => {
  it('does not depend on the working directory', () => {
    // Playwright resolves its config with cwd = apps/web, the same string in
    // every worktree. A cwd-derived offset gave every checkout identical ports
    // and let two agents silently share one server. This suite runs from the
    // repository root since #173, so compute the ports in a process started
    // elsewhere, with the E2E overrides cleared.
    const url = pathToFileURL(join(WORKTREE_ROOT, 'scripts', 'ports.mjs')).href;
    const env = { ...process.env };
    delete env['E2E_API_PORT'];
    delete env['E2E_WEB_PORT'];
    const fromElsewhere = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', `import(${JSON.stringify(url)}).then((m) => process.stdout.write(JSON.stringify(m.ports())))`],
      { cwd: tmpdir(), encoding: 'utf8', env, input: '' },
    );
    expect(JSON.parse(fromElsewhere)).toEqual(ports(WORKTREE_ROOT));
  });

  it('gives different worktrees different ports', () => {
    expect(ports('/somewhere/boris')).not.toEqual(ports('/somewhere/boris-other'));
  });

  it('keeps the two ranges disjoint', () => {
    for (const root of ['/a/one', '/a/two', '/a/three', '/a/four']) {
      const { api, web } = ports(root);
      expect(api).toBeGreaterThanOrEqual(8200);
      expect(api).toBeLessThan(8400);
      expect(web).toBeGreaterThanOrEqual(8600);
      expect(web).toBeLessThan(8800);
    }
  });

  it('lets the environment override', () => {
    vi.stubEnv('E2E_API_PORT', '9001');
    vi.stubEnv('E2E_WEB_PORT', '9002');
    expect(ports()).toEqual({ api: 9001, web: 9002 });
  });

  it('is stable for the same root', () => {
    expect(ports('/a/one')).toEqual(ports('/a/one'));
  });
});
