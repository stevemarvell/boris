// `create` runs from the base checkout alone, so these tests do too: they
// assemble from the real catalogue.json and the real tree, which a product
// does not have. They are listed in catalogue.json's `base`, and setup.test.ts
// (which ships to every product) holds the rest of setup.mjs's tests.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadCatalogue } from '../assemble.mjs';
import { ROOT } from '../project.mjs';
import { BASE_REMOTE, checkChoices, create, withoutCredentials, type Run, type Spawn } from '../setup.mjs';

describe('checkChoices', () => {
  const catalogue = loadCatalogue();

  it('accepts starters and a provider the catalogue offers, and no provider at all', () => {
    expect(() => checkChoices({ catalogue, starters: ['python-fastapi'] })).not.toThrow();
    expect(() => checkChoices({ catalogue, starters: ['python-fastapi', 'node-react'], deploy: 'vercel' })).not.toThrow();
  });

  it('names what catalogue.json offers when a starter is unknown', () => {
    expect(() => checkChoices({ catalogue, starters: ['python-fastapi', 'rails'] })).toThrow(
      'setup create: no starter named "rails" (catalogue.json offers: python-fastapi, node-react)',
    );
  });

  it('names what catalogue.json offers when a provider is unknown', () => {
    expect(() => checkChoices({ catalogue, starters: ['python-fastapi'], deploy: 'heroku' })).toThrow(
      'setup create: no provider named "heroku" (catalogue.json offers: vercel)',
    );
  });

  it('asks for a starter when none is chosen', () => {
    expect(() => checkChoices({ catalogue, starters: [] })).toThrow(/choose at least one --starter \(catalogue\.json offers: python-fastapi, node-react\)/);
  });
});

describe('withoutCredentials', () => {
  it('drops a user:password from an http(s) remote, and leaves every other URL alone', () => {
    expect(withoutCredentials('https://user:tok3n@github.com/o/r.git')).toBe('https://github.com/o/r.git');
    expect(withoutCredentials('http://x-access-token@127.0.0.1:8080/o/r')).toBe('http://127.0.0.1:8080/o/r');
    expect(withoutCredentials('https://github.com/o/r.git')).toBe('https://github.com/o/r.git');
    expect(withoutCredentials('git@github.com:o/r.git')).toBe('git@github.com:o/r.git');
  });
});

describe('create', () => {
  const SHA = '0123456789abcdef0123456789abcdef01234567';
  const BASE_URL = 'git@github.com:someone/base.git';
  type Answer = { status: number; stdout: string; stderr: string };
  const ok = (stdout = ''): Answer => ({ status: 0, stdout, stderr: '' });
  const fail = (stderr: string): Answer => ({ status: 1, stdout: '', stderr });

  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  /** A path that does not exist yet, under a scratch directory of its own. */
  function freshDir(): string {
    const parent = mkdtempSync(join(tmpdir(), 'setup-create-'));
    made.push(parent);
    return join(parent, 'n');
  }

  /**
   * The world `create` runs in: a clean base checkout at SHA with an origin, a
   * GitHub that has no `o/n` yet, and every other command succeeding. Every
   * call to `run` and `spawn` lands in one timeline, in order, so a test can
   * say what happened before what. `answers` override by prefix of
   * `cmd arg arg…`; `spawnStatus` can fail a spawned command.
   */
  function world(answers: Record<string, Answer> = {}, spawnStatus: (key: string) => number = () => 0) {
    const calls: string[][] = [];
    const spawned: { key: string; cwd: unknown }[] = [];
    const timeline: string[] = [];
    // The test's own answers come first: the first prefix that matches wins.
    const defaults: Record<string, Answer> = {
      [`git -C ${ROOT} status`]: ok(),
      [`git -C ${ROOT} rev-parse HEAD`]: ok(`${SHA}\n`),
      [`git -C ${ROOT} remote get-url origin`]: ok(`${BASE_URL}\n`),
      'gh api repos/o/n --jq .name': fail('gh: Not Found (HTTP 404)'),
      'gh api user --jq .login': ok('O\n'),
    };
    const known = [...Object.entries(answers), ...Object.entries(defaults)];
    const run: Run = async (cmd, args) => {
      calls.push([cmd, ...args]);
      const key = `${cmd} ${args.join(' ')}`;
      timeline.push(`run ${key}`);
      for (const [prefix, result] of known) if (key.startsWith(prefix)) return result;
      return ok();
    };
    const spawn: Spawn = (cmd, args, options) => {
      const key = `${cmd} ${args.join(' ')}`;
      spawned.push({ key, cwd: options?.cwd });
      timeline.push(`spawn ${key}`);
      return { status: spawnStatus(key) };
    };
    const lines: string[] = [];
    return { run, spawn, calls, spawned, timeline, lines, log: (line: string) => lines.push(line) };
  }

  /** Calls that change something: a GitHub POST, or git writing anywhere. */
  const writes = (calls: string[][]) =>
    calls.filter(
      (c) =>
        c.includes('POST') ||
        (c[0] === 'git' && ['init', 'add', 'commit', 'push'].includes(c[3] ?? '')) ||
        (c[0] === 'git' && c[3] === 'remote' && c[4] !== 'get-url'),
    );

  const python = (dir: string, extra: Record<string, unknown> = {}) => ({
    name: 'n',
    owner: 'o',
    dir,
    public: false,
    starters: ['python-fastapi'],
    ...extra,
  });

  describe('refuses before anything is created', () => {
    it('on an unknown starter, naming what the catalogue offers, having run nothing and written nothing', async () => {
      const w = world();
      const dir = freshDir();
      await expect(create(python(dir, { starters: ['python-fastapi', 'rails'] }), w)).rejects.toThrow(
        'no starter named "rails" (catalogue.json offers: python-fastapi, node-react)',
      );
      expect(w.timeline).toEqual([]);
      expect(existsSync(dir)).toBe(false);
    });

    it('on an unknown provider, naming what the catalogue offers, having run nothing and written nothing', async () => {
      const w = world();
      const dir = freshDir();
      await expect(create(python(dir, { deploy: 'heroku' }), w)).rejects.toThrow(
        'no provider named "heroku" (catalogue.json offers: vercel)',
      );
      expect(w.timeline).toEqual([]);
      expect(existsSync(dir)).toBe(false);
    });

    it('when no starter is chosen', async () => {
      const w = world();
      await expect(create(python(freshDir(), { starters: [] }), w)).rejects.toThrow(/choose at least one --starter/);
      expect(w.timeline).toEqual([]);
    });

    it('on a name the product cannot have', async () => {
      const w = world();
      const dir = freshDir();
      await expect(create(python(dir, { name: 'Bad Name' }), w)).rejects.toThrow(/name "Bad Name"/);
      expect(w.timeline).toEqual([]);
      expect(existsSync(dir)).toBe(false);
    });

    it('on a target directory that has anything in it, leaving it as it was', async () => {
      const w = world();
      const dir = freshDir();
      mkdirSync(dir);
      writeFileSync(join(dir, 'precious.txt'), 'mine');
      await expect(create(python(dir), w)).rejects.toThrow(/is not empty/);
      expect(w.timeline).toEqual([]);
      expect(readFileSync(join(dir, 'precious.txt'), 'utf8')).toBe('mine');
    });

    it('from a checkout that is not the base, which has no catalogue.json', async () => {
      const w = world();
      const elsewhere = mkdtempSync(join(tmpdir(), 'setup-notbase-'));
      made.push(elsewhere);
      await expect(create(python(freshDir()), { ...w, root: elsewhere })).rejects.toThrow(/has no catalogue\.json/);
      expect(w.timeline).toEqual([]);
    });

    it('when a tool is missing', async () => {
      const w = world({ 'uv --version': fail('uv: not found') });
      const dir = freshDir();
      await expect(create(python(dir), w)).rejects.toThrow(/missing uv/);
      expect(writes(w.calls)).toEqual([]);
      expect(existsSync(dir)).toBe(false);
    });

    it('when the base has uncommitted changes to tracked files, since engine.commit would not describe what is copied', async () => {
      const w = world({ [`git -C ${ROOT} status`]: ok(' M scripts/setup.mjs\n') });
      const dir = freshDir();
      await expect(create(python(dir), w)).rejects.toThrow(/uncommitted changes to tracked files/);
      expect(writes(w.calls)).toEqual([]);
      expect(existsSync(dir)).toBe(false);
      // Untracked files are not what is copied, so they are not asked about.
      expect(w.calls.find((c) => c.includes('status'))).toContain('--untracked-files=no');
    });

    it('when HEAD cannot be read, or is not a full SHA', async () => {
      for (const head of [fail('fatal: ambiguous argument HEAD'), ok('abc1234\n')]) {
        const w = world({ [`git -C ${ROOT} rev-parse HEAD`]: head });
        await expect(create(python(freshDir()), w)).rejects.toThrow(/rev-parse HEAD failed/);
        expect(writes(w.calls)).toEqual([]);
      }
    });

    it('when the base has no origin for the product to fetch from', async () => {
      const w = world({ [`git -C ${ROOT} remote get-url origin`]: fail('error: No such remote') });
      await expect(create(python(freshDir()), w)).rejects.toThrow(/no origin remote/);
      expect(writes(w.calls)).toEqual([]);
    });

    it('when the GitHub repository already holds something', async () => {
      const w = world({
        'gh api repos/o/n --jq .name': ok('n'),
        'gh api repos/o/n/branches': ok('[{"name":"develop"}]'),
      });
      const dir = freshDir();
      await expect(create(python(dir), w)).rejects.toThrow(/already exists and is not empty/);
      expect(writes(w.calls)).toEqual([]);
      expect(existsSync(dir)).toBe(false);
    });

    it('when the emptiness check itself fails, never assuming empty', async () => {
      const w = world({
        'gh api repos/o/n --jq .name': ok('n'),
        'gh api repos/o/n/branches': fail('API rate limit exceeded'),
      });
      const dir = freshDir();
      await expect(create(python(dir), w)).rejects.toThrow(/API rate limit exceeded/);
      expect(writes(w.calls)).toEqual([]);
      expect(existsSync(dir)).toBe(false);
    });
  });

  describe('assembles a product and publishes it', () => {
    it('builds the chosen parts with the base commit recorded, commits once, then creates the repository and pushes', async () => {
      const w = world();
      const dir = freshDir();
      const exitCode = await create(python(dir), w);
      expect(exitCode).toBe(0);

      const written = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'));
      expect(written.name).toBe('n');
      expect(written.engine).toEqual({ commit: SHA });
      expect(Object.keys(written.apps)).toEqual(['api']);
      expect(existsSync(join(dir, 'apps/api/pyproject.toml'))).toBe(true);
      expect(existsSync(join(dir, 'apps/web'))).toBe(false);

      const at = (needle: string) => {
        const index = w.timeline.findIndex((entry) => entry.includes(needle));
        expect(index, needle).toBeGreaterThanOrEqual(0);
        return index;
      };
      const order = [
        at(`git -C ${dir} init -b develop`),
        at('spawn npx npm@11 install'),
        at(`git -C ${dir} add -A`),
        at('spawn npm run bootstrap'),
        at('spawn npm run verify'),
        at(`git -C ${dir} commit -m Start n from ${BASE_REMOTE}@0123456 -m engine.commit ${SHA}`),
        at(`git -C ${dir} remote add ${BASE_REMOTE} ${BASE_URL}`),
        at(`git -C ${dir} remote set-url --push ${BASE_REMOTE} DISABLED`),
        at('gh api user/repos -X POST -f name=n -F private=true'),
        at(`git -C ${dir} remote add origin git@github.com:o/n.git`),
        at(`git -C ${dir} push -u origin develop`),
        at('spawn node scripts/setup.mjs check'),
      ];
      expect(order).toEqual([...order].sort((a, b) => a - b));
      // A history-less product: nothing is cloned from the base, and nothing goes to it.
      expect(w.calls.some((c) => c[0] === 'git' && (c.includes('clone') || c.includes('fetch')))).toBe(false);
      expect(w.calls.some((c) => c[0] === 'gh' && c[1] === 'repo')).toBe(false);
      // Everything run in the product runs in the product.
      expect(w.spawned.every((s) => s.cwd === dir)).toBe(true);
    });

    it('locks a python-only product with npm 11 before the first commit, and leaves a node-react one to its own lockfile', async () => {
      const pythonOnly = world();
      await create(python(freshDir()), pythonOnly);
      expect(pythonOnly.spawned.map((s) => s.key)).toContain('npx npm@11 install');

      const withNode = world();
      const dir = freshDir();
      await create(python(dir, { starters: ['python-fastapi', 'node-react'] }), withNode);
      expect(existsSync(join(dir, 'package-lock.json'))).toBe(true);
      expect(withNode.spawned.map((s) => s.key)).not.toContain('npx npm@11 install');
      expect(Object.keys(JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')).apps).sort()).toEqual(['api', 'web']);
    });

    it("returns the product's own check exit code, run from the product and not from this checkout", async () => {
      const dir = freshDir();
      const w = world({}, (key) => (key === 'node scripts/setup.mjs check' ? 3 : 0));
      expect(await create(python(dir), w)).toBe(3);
      const check = w.spawned.filter((s) => s.key === 'node scripts/setup.mjs check');
      expect(check).toEqual([{ key: 'node scripts/setup.mjs check', cwd: dir }]);
    });

    it('creates it under the organisation, publicly if asked, and under the account when that is the owner', async () => {
      const org = world({ 'gh api user --jq .login': ok('someone-else\n') });
      await create(python(freshDir(), { public: true }), org);
      expect(org.calls).toContainEqual(['gh', 'api', 'orgs/o/repos', '-X', 'POST', '-f', 'name=n', '-F', 'private=false']);

      const own = world({ 'gh api user --jq .login': ok('O\n') });
      await create(python(freshDir()), own);
      expect(own.calls).toContainEqual(['gh', 'api', 'user/repos', '-X', 'POST', '-f', 'name=n', '-F', 'private=true']);
    });

    it('adopts an existing empty repository instead of creating one', async () => {
      const w = world({ 'gh api repos/o/n --jq .name': ok('n'), 'gh api repos/o/n/branches': ok('[]') });
      await create(python(freshDir()), w);
      expect(w.calls.some((c) => c.includes('POST'))).toBe(false);
      expect(w.calls.some((c) => c.includes('push'))).toBe(true);
    });

    it('creates nothing on GitHub, and pushes nothing, when the product fails its own verify', async () => {
      const w = world({}, (key) => (key === 'npm run verify' ? 1 : 0));
      const dir = freshDir();
      await expect(create(python(dir), w)).rejects.toThrow(/npm run verify failed/);
      expect(w.calls.some((c) => c.includes('POST') || c.includes('push') || c.includes('commit'))).toBe(false);
      // The directory is left for the owner to look at.
      expect(existsSync(join(dir, 'project.json'))).toBe(true);
    });

    it('stops before verify, and before GitHub, when the lockfile cannot be written', async () => {
      const w = world({}, (key) => (key.startsWith('npx npm@11') ? 1 : 0));
      await expect(create(python(freshDir()), w)).rejects.toThrow(/npm install .* failed/);
      expect(w.spawned.map((s) => s.key)).not.toContain('npm run verify');
      expect(w.calls.some((c) => c.includes('POST'))).toBe(false);
    });

    it('stops, saying which, when a git step in the product fails, and creates nothing on GitHub', async () => {
      const w = world();
      const run: Run = async (cmd, args) => (cmd === 'git' && args[2] === 'commit' ? fail('Author identity unknown') : w.run(cmd, args));
      await expect(create(python(freshDir()), { ...w, run })).rejects.toThrow(/git commit failed .*Author identity unknown/);
      expect(w.calls.some((c) => c.includes('POST'))).toBe(false);
    });

    it('never writes a credential from the base remote into the product', async () => {
      const w = world({ [`git -C ${ROOT} remote get-url origin`]: ok('https://user:secret@github.com/someone/base.git\n') });
      await create(python(freshDir()), w);
      const added = w.calls.find((c) => c.includes('remote') && c.includes(BASE_REMOTE) && c.includes('add'));
      expect(added).toContain('https://github.com/someone/base.git');
      expect(w.calls.flat().some((a) => a.includes('secret'))).toBe(false);
    });
  });

  describe('--deploy', () => {
    it('prints the deploy:add command for each app, and sets nothing up', async () => {
      const w = world();
      await create(python(freshDir(), { starters: ['python-fastapi', 'node-react'], deploy: 'vercel' }), w);
      expect(w.lines).toContain('  npm run deploy:add -- vercel --app api');
      expect(w.lines).toContain('  npm run deploy:add -- vercel --app web');
      expect(w.timeline.filter((entry) => /deploy|vercel/.test(entry))).toEqual([]);
    });

    it('prints nothing about a provider when none was asked for', async () => {
      const w = world();
      await create(python(freshDir()), w);
      expect(w.lines.some((line) => line.includes('deploy:add'))).toBe(false);
    });
  });

  it('with real git in the product: one commit and no other history, a fetch-only base remote, the commit recorded and the tree clean', async () => {
    const w = world();
    const dir = freshDir();
    // Real git for the product, so the commit and the remotes are real; the
    // base checkout's own answers and GitHub stay the world's. The push has
    // nowhere to go, so it is the one product call that stays pretend.
    const run: Run = async (cmd, args) => {
      if (cmd === 'git' && args[0] === '-C' && args[1] === dir && args[2] !== 'push') {
        try {
          const stdout = execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
          return ok(stdout);
        } catch (error) {
          return fail(String((error as { stderr?: string }).stderr));
        }
      }
      return w.run(cmd, args);
    };
    await create(python(dir), { ...w, run });

    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
    expect(git('rev-list', '--all', '--count')).toBe('1');
    expect(git('log', '-1', '--format=%s')).toBe(`Start n from ${BASE_REMOTE}@0123456`);
    expect(git('log', '-1', '--format=%b')).toContain(`engine.commit ${SHA}`);
    expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('develop');
    // `config`, not `remote get-url`: the latter applies the machine's own url.insteadOf rewrites.
    expect(git('config', '--get', `remote.${BASE_REMOTE}.url`)).toBe(BASE_URL);
    expect(git('config', '--get', `remote.${BASE_REMOTE}.pushurl`)).toBe('DISABLED');
    expect(git('config', '--get', 'remote.origin.url')).toBe('git@github.com:o/n.git');
    expect(JSON.parse(git('show', 'HEAD:project.json')).engine).toEqual({ commit: SHA });
    expect(git('status', '--porcelain')).toBe('');
    // The base's own files stay behind.
    expect(git('ls-files', 'catalogue.json', 'docs/adoption.md', 'scripts/assemble.mjs')).toBe('scripts/assemble.mjs');
  });
});
