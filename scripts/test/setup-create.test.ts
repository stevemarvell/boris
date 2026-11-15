// `create` runs from the base checkout alone, so these tests do too: they
// assemble from the real catalogue.json and the real tree, which a product
// does not have. They are listed in catalogue.json's `base`, and setup.test.ts
// (which ships to every product) holds the rest of setup.mjs's tests.
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assemble, loadCatalogue } from '../assemble.mjs';
import { ROOT } from '../project.mjs';
import { BASE_REMOTE, add, checkChoices, checkOwner, create, withoutCredentials, type Run, type Spawn } from '../setup.mjs';

describe('checkChoices', () => {
  const catalogue = loadCatalogue();

  it('accepts starters and a provider the catalogue offers, and no provider at all', () => {
    expect(() => checkChoices({ catalogue, starters: ['python-fastapi'] })).not.toThrow();
    expect(() => checkChoices({ catalogue, starters: ['python-fastapi', 'node-react'], deploy: 'vercel' })).not.toThrow();
  });

  it('accepts node-react, alone and with the API: no starter is held back', () => {
    expect(() => checkChoices({ catalogue, starters: ['node-react'] })).not.toThrow();
    expect(() => checkChoices({ catalogue, starters: ['python-fastapi', 'node-react'] })).not.toThrow();
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

  it('accepts no starter at all: that is an engine-only product', () => {
    expect(() => checkChoices({ catalogue, starters: [] })).not.toThrow();
    expect(() => checkChoices({ catalogue, starters: [], deploy: 'vercel' })).not.toThrow();
    // A provider is still checked, with or without starters.
    expect(() => checkChoices({ catalogue, starters: [], deploy: 'heroku' })).toThrow(/no provider named "heroku"/);
  });
});

describe('withoutCredentials', () => {
  it('drops the whole userinfo from an http(s) remote, where the user part can itself be a token', () => {
    expect(withoutCredentials('https://user:tok3n@github.com/o/r.git')).toBe('https://github.com/o/r.git');
    expect(withoutCredentials('http://x-access-token@127.0.0.1:8080/o/r')).toBe('http://127.0.0.1:8080/o/r');
    expect(withoutCredentials('HTTPS://ghp_abc@github.com/o/r.git')).toBe('HTTPS://github.com/o/r.git');
  });

  it('drops only the password from any other scheme://userinfo@host URL, ssh included, keeping the username git needs to connect', () => {
    expect(withoutCredentials('ssh://git:secret@github.com/o/r.git')).toBe('ssh://git@github.com/o/r.git');
    expect(withoutCredentials('git+ssh://deploy:hunter2@host.example:2222/o/r.git')).toBe('git+ssh://deploy@host.example:2222/o/r.git');
    expect(withoutCredentials('ssh://git@github.com/o/r.git')).toBe('ssh://git@github.com/o/r.git');
  });

  it('leaves a URL with no userinfo, and scp-style git@host:path (where git is a username, not a secret), alone', () => {
    expect(withoutCredentials('https://github.com/o/r.git')).toBe('https://github.com/o/r.git');
    expect(withoutCredentials('git@github.com:o/r.git')).toBe('git@github.com:o/r.git');
    expect(withoutCredentials('/home/me/base')).toBe('/home/me/base');
  });
});

describe('checkOwner', () => {
  it('accepts a GitHub login or organisation name', () => {
    for (const owner of ['o', 'O', 'stevemarvell', 'my-org', 'a1', 'a'.repeat(39)]) expect(() => checkOwner(owner), owner).not.toThrow();
  });

  it('refuses anything that could reshape a REST path or a remote URL', () => {
    for (const owner of ['x/../../orgs/y', 'a?b', 'a/b', '', '-a', 'a b', 'a#b', 'a..b', 'a@b', 'a:b', 'a'.repeat(40)]) {
      expect(() => checkOwner(owner), owner).toThrow(/owner/);
    }
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

    it('on an owner that could reshape a REST path or the origin URL, having run nothing and written nothing', async () => {
      for (const owner of ['x/../../orgs/y', 'a?b']) {
        const w = world();
        const dir = freshDir();
        await expect(create(python(dir, { owner }), w)).rejects.toThrow(/owner/);
        expect(w.timeline, owner).toEqual([]);
        expect(existsSync(dir), owner).toBe(false);
      }
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
        at('spawn gh repo set-default o/n'),
        at('spawn node scripts/setup.mjs check --repo o/n'),
      ];
      expect(order).toEqual([...order].sort((a, b) => a - b));
      // A history-less product: nothing is cloned from the base, and nothing goes to it.
      expect(w.calls.some((c) => c[0] === 'git' && (c.includes('clone') || c.includes('fetch')))).toBe(false);
      expect(w.calls.some((c) => c[0] === 'gh' && c[1] === 'repo')).toBe(false);
      // Everything run in the product runs in the product.
      expect(w.spawned.every((s) => s.cwd === dir)).toBe(true);
    });

    it('pins gh to the product after the push (two remotes make {owner}/{repo} ambiguous), and only warns if it fails', async () => {
      const dir = freshDir();
      const w = world();
      await create(python(dir), w);
      expect(w.spawned).toContainEqual({ key: 'gh repo set-default o/n', cwd: dir });
      const push = w.timeline.findIndex((e) => e.includes('push -u origin develop'));
      const pin = w.timeline.indexOf('spawn gh repo set-default o/n');
      expect(pin).toBeGreaterThan(push);

      const failing = world({}, (key) => (key.startsWith('gh repo set-default') ? 1 : 0));
      const failDir = freshDir();
      await expect(create(python(failDir), failing)).resolves.toBe(0);
      expect(failing.lines.some((l) => l.includes('`gh repo set-default o/n`') && l.includes(failDir))).toBe(true);
      expect(failing.spawned).toContainEqual({ key: 'node scripts/setup.mjs check --repo o/n', cwd: failDir });
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

    it('creates an engine-only product when no --starter is given: no apps, no apps directory, no uv asked for, and locked before verify', async () => {
      // uv installs a Python app's dependencies, so a machine without it can still make a product that has none.
      const w = world({ 'uv --version': fail('uv: not found') });
      const dir = freshDir();
      expect(await create(python(dir, { starters: [] }), w)).toBe(0);

      const written = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'));
      expect(written.apps).toEqual({});
      expect(written.engine).toEqual({ commit: SHA });
      expect(existsSync(join(dir, 'apps'))).toBe(false);
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      expect(manifest).not.toHaveProperty('workspaces');
      expect(existsSync(join(dir, 'package-lock.json'))).toBe(false); // written by the npm 11 install, which is pretend here
      expect(w.lines[0]).toContain('the engine alone (no starter)');

      const keys = w.spawned.map((s) => s.key);
      expect(keys).toEqual(['npx npm@11 install', 'npm run bootstrap', 'npm run verify', 'gh repo set-default o/n', 'node scripts/setup.mjs check --repo o/n']);
      expect(w.calls.some((c) => c[0] === 'uv')).toBe(false);
      expect(w.calls).toContainEqual(['gh', 'api', 'user/repos', '-X', 'POST', '-f', 'name=n', '-F', 'private=true']);
    });

    it('still needs uv for a product with a Python app', async () => {
      const w = world({ 'uv --version': fail('uv: not found') });
      await expect(create(python(freshDir(), { starters: ['python-fastapi'] }), w)).rejects.toThrow(/missing uv/);
      const node = world({ 'uv --version': fail('uv: not found') });
      expect(await create(python(freshDir(), { starters: ['node-react'] }), node)).toBe(0);
      expect(node.calls.some((c) => c[0] === 'uv')).toBe(false);
    });

    it('creates a node-react-only product: nothing is refused, and the product holds the web app and no API', async () => {
      const w = world();
      const dir = freshDir();
      expect(await create(python(dir, { starters: ['node-react'] }), w)).toBe(0);
      expect(Object.keys(JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')).apps)).toEqual(['web']);
      expect(existsSync(join(dir, 'apps/web/package.json'))).toBe(true);
      expect(existsSync(join(dir, 'apps/api'))).toBe(false);
      // The base's own pages are not copied, and nothing stands in for them.
      expect(existsSync(join(dir, 'docs/adoption.md'))).toBe(false);
      expect(existsSync(join(dir, 'index.html'))).toBe(false);
    });

    it("returns the product's own check exit code, run from the product and not from this checkout", async () => {
      const dir = freshDir();
      const w = world({}, (key) => (key === 'node scripts/setup.mjs check --repo o/n' ? 3 : 0));
      expect(await create(python(dir), w)).toBe(3);
      const check = w.spawned.filter((s) => s.key === 'node scripts/setup.mjs check --repo o/n');
      expect(check).toEqual([{ key: 'node scripts/setup.mjs check --repo o/n', cwd: dir }]);
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

    it('says how to recover when creating the repository or pushing fails after the product is built', async () => {
      const creating = world({ 'gh api user/repos': fail('HTTP 403') });
      const pushing = world();
      const failPush: Run = async (cmd, args) => (args.includes('push') ? fail('remote: Permission denied') : pushing.run(cmd, args));
      for (const [w, deps, why] of [
        [creating, creating, /HTTP 403/],
        [pushing, { ...pushing, run: failPush }, /Permission denied/],
      ] as const) {
        const dir = freshDir();
        const message = await create(python(dir), deps).then(
          () => '',
          (error: Error) => error.message,
        );
        expect(message).toMatch(why);
        // The way back: the empty repository is accepted on a rerun; the directory is not.
        expect(message).toContain('o/n may exist but be empty');
        expect(message).toMatch(/rerun/);
        expect(message).toContain(`remove ${dir} first`);
        expect(existsSync(join(dir, 'project.json'))).toBe(true);
        void w;
      }
    });

    it('does not add the recovery text to a failure before the product is built, which leaves nothing to clean up', async () => {
      const w = world({ 'gh api repos/o/n --jq .name': ok('n'), 'gh api repos/o/n/branches': fail('API rate limit exceeded') });
      const message = await create(python(freshDir()), w).then(
        () => '',
        (error: Error) => error.message,
      );
      expect(message).toMatch(/API rate limit exceeded/);
      expect(message).not.toMatch(/may exist but be empty|remove .* first/);
    });

    it('never writes a credential from the base remote into the product, whatever the scheme', async () => {
      const ssh = world({ [`git -C ${ROOT} remote get-url origin`]: ok('ssh://git:secret@github.com/someone/base.git\n') });
      await create(python(freshDir()), ssh);
      const addedSsh = ssh.calls.find((c) => c.includes('remote') && c.includes(BASE_REMOTE) && c.includes('add'));
      expect(addedSsh).toContain('ssh://git@github.com/someone/base.git');
      expect(ssh.calls.flat().some((a) => a.includes('secret'))).toBe(false);
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

    it('says there is nothing to deploy for a product with no apps, rather than print an empty list', async () => {
      const w = world();
      await create(python(freshDir(), { starters: [], deploy: 'vercel' }), w);
      expect(w.lines.some((line) => /has no apps, so there is nothing to deploy yet/.test(line))).toBe(true);
      expect(w.lines.some((line) => line.includes('deploy:add -- vercel --app'))).toBe(false);
    });

    it('prints nothing about a provider when none was asked for', async () => {
      const w = world();
      await create(python(freshDir()), w);
      expect(w.lines.some((line) => line.includes('deploy:add'))).toBe(false);
    });
  });

  // Timeout: runs real git init, add, commit and remotes (413 ms quiet); 30 s.
  it('with real git in the product: one commit and no other history, a fetch-only base remote, the commit recorded and the tree clean', { timeout: 30_000 }, async () => {
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

// Helpers for `add`'s tests, at module level: a helper in a describe body is
// counted as a spawn at collection time (spawn-timeout.test.ts).
const made: string[] = [];
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'setup-add-test-'));
  made.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();

/** A stand-in for the base: this checkout's tracked files, committed in a repository of their own. */
const fakeBase = () => {
  const dir = scratch();
  for (const file of execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)) {
    if (!existsSync(join(ROOT, file))) continue;
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    copyFileSync(join(ROOT, file), join(dir, file));
    chmodSync(join(dir, file), statSync(join(ROOT, file)).mode & 0o777);
  }
  git(dir, 'init', '-q', '-b', 'develop');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return { dir, sha: git(dir, 'rev-parse', 'HEAD') };
};

/** An engine-only product built from `base`, committed, with a fetch-only remote to it. */
const product = (base: { dir: string; sha: string }) => {
  const dir = join(scratch(), 'widgets');
  assemble({ root: base.dir, target: dir, name: 'widgets', starters: [], engineCommit: base.sha });
  git(dir, 'init', '-q', '-b', 'develop');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'start');
  git(dir, 'remote', 'add', BASE_REMOTE, base.dir);
  return dir;
};

const files = (dir: string, rel = ''): string[] =>
  readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    const path = rel ? `${rel}/${e.name}` : e.name;
    return e.name === '.git' ? [] : e.isDirectory() ? files(dir, path) : [path];
  });
const installs: { cmd: string; args: string[]; cwd: unknown }[] = [];
// No real install: it would reach the network. What add asked for is recorded.
const quiet = {
  log: () => {},
  spawn: (cmd: string, args: string[], options?: Record<string, unknown>) => {
    installs.push({ cmd, args, cwd: options?.cwd });
    return { status: 0 };
  },
};


describe('add, inside a product', () => {
  it('gives an engine-only product the same tree as create with both starters', { timeout: 120_000 }, async () => {
    const base = fakeBase();
    const dir = product(base);
    const result = await add({ starters: ['python-fastapi', 'node-react'] }, { root: dir, ...quiet });
    expect(result.kept).toEqual([]);

    const expected = join(scratch(), 'expected');
    assemble({ root: base.dir, target: expected, name: 'widgets', starters: ['python-fastapi', 'node-react'], engineCommit: base.sha });
    expect(files(dir)).toEqual(files(expected));
    // Compared by bytes, read here and not by the code under test; the mode too, for the scripts.
    for (const file of files(expected)) {
      expect(readFileSync(join(dir, file)).equals(readFileSync(join(expected, file))), file).toBe(true);
      expect(statSync(join(dir, file)).mode & 0o777, file).toBe(statSync(join(expected, file)).mode & 0o777);
    }
  });

  it('adds one starter at a time, and the second brings the layout of both', { timeout: 120_000 }, async () => {
    const base = fakeBase();
    const dir = product(base);
    await add({ starters: ['python-fastapi'] }, { root: dir, ...quiet });
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'api');
    await add({ starters: ['node-react'] }, { root: dir, ...quiet });
    const expected = join(scratch(), 'expected');
    assemble({ root: base.dir, target: expected, name: 'widgets', starters: ['python-fastapi', 'node-react'], engineCommit: base.sha });
    expect(files(dir)).toEqual(files(expected));
    for (const file of files(expected)) expect(readFileSync(join(dir, file)).equals(readFileSync(join(expected, file))), file).toBe(true);
  });

  it('refuses a dirty tree, and writes nothing', { timeout: 60_000 }, async () => {
    const dir = product(fakeBase());
    writeFileSync(join(dir, 'notes.txt'), 'wip');
    await expect(add({ starters: ['node-react'] }, { root: dir, ...quiet })).rejects.toThrow(/uncommitted changes \(notes\.txt\)/);
    expect(existsSync(join(dir, 'apps'))).toBe(false);
    writeFileSync(join(dir, 'README.md'), 'edited');
    await expect(add({ starters: ['node-react'] }, { root: dir, ...quiet })).rejects.toThrow(/uncommitted changes/);
  });

  it('refuses an app path that already exists, and writes nothing', { timeout: 60_000 }, async () => {
    const dir = product(fakeBase());
    mkdirSync(join(dir, 'apps/web'), { recursive: true });
    writeFileSync(join(dir, 'apps/web/mine.txt'), 'mine');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'mine');
    await expect(add({ starters: ['node-react'] }, { root: dir, ...quiet })).rejects.toThrow(/app "web" \(starter "node-react"\) is already present .*apps\/web/);
    expect(files(dir).filter((f) => f.startsWith('apps/'))).toEqual(['apps/web/mine.txt']);
    expect(JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')).apps).toEqual({});
  });

  it('refuses a starter the product already has, by the app it declares', { timeout: 120_000 }, async () => {
    const dir = product(fakeBase());
    await add({ starters: ['node-react'] }, { root: dir, ...quiet });
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'web');
    await expect(add({ starters: ['node-react'] }, { root: dir, ...quiet })).rejects.toThrow(/app "web" .* is already present/);
  });

  it('refuses a starter given twice with its own message, before fetching anything', { timeout: 60_000 }, async () => {
    const dir = product(fakeBase());
    await expect(add({ starters: ['node-react', 'node-react'] }, { root: dir, ...quiet })).rejects.toThrow(/starter "node-react" is given more than once/);
    expect(existsSync(join(dir, 'apps'))).toBe(false);
  });

  it('names the paths of a dirty tree plainly, not quoted or escaped', { timeout: 60_000 }, async () => {
    const dir = product(fakeBase());
    writeFileSync(join(dir, 'my notes é.txt'), 'wip');
    await expect(add({ starters: ['node-react'] }, { root: dir, ...quiet })).rejects.toThrow(/\(my notes é\.txt\)/);
  });

  it('brings a lockfile the product already has up to date when package.json changes, and keeps it', { timeout: 120_000 }, async () => {
    const dir = product(fakeBase());
    writeFileSync(join(dir, 'package-lock.json'), '{"name":"widgets","lockfileVersion":3,"packages":{}}\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'lock');
    installs.length = 0;
    await add({ starters: ['node-react'] }, { root: dir, ...quiet });
    expect(installs).toEqual([{ cmd: 'npx', args: ['npm@11', 'install'], cwd: dir }]);
    // The starter's own lockfile does not replace the product's.
    expect(readFileSync(join(dir, 'package-lock.json'), 'utf8')).toBe('{"name":"widgets","lockfileVersion":3,"packages":{}}\n');
    expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).workspaces).toBeDefined();
  });

  it('runs no install when the starter brings the lockfile, and stops with a message when the install fails', { timeout: 120_000 }, async () => {
    installs.length = 0;
    await add({ starters: ['node-react'] }, { root: product(fakeBase()), ...quiet });
    expect(installs).toEqual([]);
    const dir = product(fakeBase());
    await expect(add({ starters: ['python-fastapi'] }, { root: dir, ...quiet, spawn: () => ({ status: 1 }) })).rejects.toThrow(/npx npm@11 install failed/);
  });

  it('refuses an unknown starter, naming what the base offers', { timeout: 60_000 }, async () => {
    const dir = product(fakeBase());
    await expect(add({ starters: ['nope'] }, { root: dir, ...quiet })).rejects.toThrow(/no starter named "nope".*node-react/);
    expect(existsSync(join(dir, 'apps'))).toBe(false);
  });

  it('treats a name from Object.prototype as unknown, not as a starter', { timeout: 60_000 }, async () => {
    const dir = product(fakeBase());
    for (const key of ['constructor', 'toString', '__proto__']) {
      await expect(add({ starters: [key] }, { root: dir, ...quiet })).rejects.toThrow(new RegExp(`no starter named "${key}"`));
    }
    expect(existsSync(join(dir, 'apps'))).toBe(false);
  });

  it('refuses a repository with no engine.commit or no base remote', { timeout: 60_000 }, async () => {
    const dir = product(fakeBase());
    git(dir, 'remote', 'remove', BASE_REMOTE);
    await expect(add({ starters: ['node-react'] }, { root: dir, ...quiet })).rejects.toThrow(new RegExp(`no ${BASE_REMOTE} remote`));
    const bare = scratch();
    writeFileSync(join(bare, 'project.json'), JSON.stringify({ name: 'x', apps: {} }));
    await expect(add({ starters: ['node-react'] }, { root: bare, ...quiet })).rejects.toThrow(/no engine\.commit/);
  });

  it('leaves a derived file the product has rewritten, and says so', { timeout: 120_000 }, async () => {
    const dir = product(fakeBase());
    writeFileSync(join(dir, 'CLAUDE.md'), '# widgets\n\nMy own words.\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'rewrite');
    const lines: string[] = [];
    const result = await add({ starters: ['node-react'] }, { root: dir, log: (l: string) => lines.push(l) });
    expect(result.kept).toEqual(['CLAUDE.md']);
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe('# widgets\n\nMy own words.\n');
    expect(lines.join('\n')).toMatch(/Left as they are.*CLAUDE\.md/);
    expect(existsSync(join(dir, 'apps/web'))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).workspaces).toBeDefined();
  });

  // Dependabot-style bump of the product's root package.json, committed.
  const bumpRoot = (dir: string) => {
    const file = join(dir, 'package.json');
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    manifest.devDependencies.eslint = '10.14.0';
    manifest.devDependencies.vitest = '5.1.0';
    writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'dependabot');
    return manifest;
  };

  it('merges workspaces and scripts into a root package.json Dependabot has bumped', { timeout: 120_000 }, async () => {
    const base = fakeBase();
    const dir = product(base);
    const bumped = bumpRoot(dir);
    expect(bumped.workspaces).toBeUndefined();
    const result = await add({ starters: ['node-react', 'python-fastapi'] }, { root: dir, ...quiet });
    expect(result.kept).toEqual([]);
    const expected = join(scratch(), 'expected');
    assemble({ root: base.dir, target: expected, name: 'widgets', starters: ['node-react', 'python-fastapi'], engineCommit: base.sha });
    const want = JSON.parse(readFileSync(join(expected, 'package.json'), 'utf8'));
    const got = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(got.workspaces).toEqual(want.workspaces);
    expect(got.scripts).toEqual(want.scripts);
    // Differs from the bumped file only by those two keys: the bumped versions stay.
    const without = (m: Record<string, unknown>) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== 'workspaces' && k !== 'scripts'));
    expect(without(got)).toEqual(without(bumped));
    expect(got.devDependencies.eslint).toBe('10.14.0');
  });

  it("aligns a new starter's shared tooling pins with the bumped root", { timeout: 120_000 }, async () => {
    const dir = product(fakeBase());
    bumpRoot(dir);
    await add({ starters: ['node-react'] }, { root: dir, ...quiet });
    const web = JSON.parse(readFileSync(join(dir, 'apps/web/package.json'), 'utf8'));
    const pins = { ...web.dependencies, ...web.devDependencies };
    expect(pins.eslint).toBe('10.14.0');
    expect(pins.vitest).toBe('5.1.0');
  });

  it('leaves a root package.json that is not JSON as it is, and says so', { timeout: 120_000 }, async () => {
    const dir = product(fakeBase());
    writeFileSync(join(dir, 'package.json'), 'not json {\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'broken');
    const lines: string[] = [];
    const result = await add({ starters: ['node-react'] }, { root: dir, log: (l: string) => lines.push(l), spawn: () => ({ status: 0 }) });
    expect(result.kept).toEqual(['package.json']);
    expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe('not json {\n');
    expect(lines.join('\n')).toMatch(/package\.json was left as it is/);
  });
});
