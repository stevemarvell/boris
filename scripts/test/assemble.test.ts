import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { LIMITS, ROOT, assemble, dependabotYml, loadCatalogue, parseArgs, plan, sharedBlock, splitDependabot, under, type Catalogue } from '../assemble.mjs';
import { loadProject } from '../project.mjs';

const made: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'assemble-test-'));
  made.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** Every file under `dir`, relative and sorted: what is actually on disk, read without the module under test. */
function listing(dir: string, rel = ''): string[] {
  return readdirSync(join(dir, rel), { withFileTypes: true })
    .flatMap((entry) => {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      return entry.isDirectory() ? listing(dir, path) : [path];
    })
    .sort();
}

// ---------------------------------------------------------------------------
// The real repository: each starter, assembled and checked
// ---------------------------------------------------------------------------

const catalogue = loadCatalogue();
const project = loadProject();
// Committed files only, as assemble reads them: an untracked file is never part of a product.
const gitFiles = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

/**
 * What a product of `chosen` must hold, from git's list of files rather than
 * from the walk assemble.mjs does: so a file the walk wrongly keeps (build
 * output, a local secret) or wrongly drops is a difference, not a match.
 */
function expectedFiles(chosen: string[]): string[] {
  const nonEngine = [...catalogue.seeded.paths, ...catalogue.generated.paths, ...catalogue.base.paths];
  const starters = chosen.map((key) => catalogue.starters[key]!);
  const out = new Set<string>();
  for (const file of gitFiles) {
    const engine = catalogue.engine.paths.some((p) => under(p, file)) && !nonEngine.some((p) => under(p, file));
    const seeded = catalogue.seeded.paths.some((p) => under(p, file));
    const owned = starters.some((s) => {
      const dir = project.apps[s.app]!.path;
      return (under(dir, file) && !s.build.some((b) => under(b, file))) || s.files.some((f) => under(f, file));
    });
    if (engine || seeded || owned) out.add(file);
  }
  for (const generated of catalogue.generated.paths) out.add(generated);
  return [...out].sort();
}

// No starter at all is a combination too: an engine-only product.
const COMBINATIONS: string[][] = [['python-fastapi'], ['node-react'], ['python-fastapi', 'node-react'], []];
const ENGINE_COMMIT = '0123456789abcdef0123456789abcdef01234567';

describe.each(COMBINATIONS.map((starters) => [starters.length ? starters.join(' + ') : 'no starter (engine only)', starters] as const))('assembling %s', (_label, chosen) => {
  const target = join(scratch(), 'product');
  const result = assemble({ target, name: 'widgets', starters: chosen, engineCommit: ENGINE_COMMIT });
  const onDisk = listing(target);

  it('writes exactly the engine, the starters and the generated files: every one present, nothing else', () => {
    const expected = expectedFiles(chosen);
    expect(onDisk.filter((f) => !expected.includes(f))).toEqual([]);
    expect(expected.filter((f) => !onDisk.includes(f))).toEqual([]);
    expect(result.files).toEqual(onDisk);
  });

  it('carries the loop and leaves the base alone', () => {
    for (const present of [
      'scripts/verify-apps.mjs',
      'scripts/project.mjs',
      'scripts/deploy/vercel/index.mjs',
      'scripts/deploy/vercel/template/SKILL.md',
      '.claude/skills/delegate/SKILL.md',
      '.claude/hooks/verify-on-stop.mjs',
      '.claude/settings.json',
      '.github/workflows/verify.yml',
      'docs/sops.md',
      'labels.json',
    ]) {
      expect(onDisk, present).toContain(present);
    }
    for (const absent of [
      'catalogue.json',
      'apps/CLAUDE.md',
      '.claude/trials/model-tiering.md',
      'scripts/test/catalogue.test.ts',
      'scripts/test/assemble.test.ts',
    ]) {
      expect(onDisk, absent).not.toContain(absent);
    }
    expect(onDisk.filter((f) => /(^|\/)(node_modules|dist|\.venv|__pycache__)\//.test(f))).toEqual([]);
  });

  it("replaces the base's own documents with the product's", () => {
    const governance = readFileSync(join(target, 'docs/data-governance.md'), 'utf8');
    expect(governance).toMatch(/^# Data governance\n\nA stub/);
    // The engine ships credentialed workflows, so the stub says what they read and what voids the posture.
    expect(governance).toContain('## What CI holds, and what voids that');
    expect(governance).toContain('a second person gets write access');
    // …and it names every secret the shipped workflows actually read, found by reading them.
    const used = new Set<string>();
    for (const file of readdirSync(join(target, '.github/workflows'))) {
      for (const match of readFileSync(join(target, '.github/workflows', file), 'utf8').matchAll(/secrets\.([A-Z_]+)/g)) used.add(match[1]!);
    }
    expect(used.size).toBeGreaterThan(0);
    expect([...used].filter((secret) => !governance.includes(secret))).toEqual([]);
    expect(readFileSync(join(target, 'docs/data-governance.md'), 'utf8')).not.toBe(readFileSync(join(ROOT, 'docs/data-governance.md'), 'utf8'));
    // The base's adoption ladder and step-0 page are the base's alone, whatever starter is chosen:
    // a placeholder for either would misrepresent a document that preserves its source's wording.
    expect(onDisk).not.toContain('docs/adoption.md');
    expect(onDisk).not.toContain('index.html');
  });

  it("writes a project.json that validates, names the product, and holds only the chosen apps, each as the base declares it", () => {
    const written = loadProject(join(target, 'project.json'));
    expect(written.name).toBe('widgets');
    const apps = chosen.map((key) => catalogue.starters[key]!.app).sort();
    expect(Object.keys(written.apps).sort()).toEqual(apps);
    // As the base declares it, less what only the base has: the web starter reads the base's root index.html.
    for (const app of apps) {
      const own = project.apps[app]!;
      expect(written.apps[app]).toEqual({ ...own, reads: own.reads.filter((path) => !catalogue.base.paths.some((b) => under(b, path))) });
    }
    if (chosen.includes('node-react')) {
      expect(project.apps['web']!.reads).toContain('index.html');
      expect(written.apps['web']!.reads).not.toContain('index.html');
      expect(written.apps['web']!.reads).toContain('docs');
    }
  });

  it("has everything each app's project.json entry reads or smoke-tests", () => {
    const written = loadProject(join(target, 'project.json'));
    for (const [name, app] of Object.entries(written.apps)) {
      for (const path of [...app.reads, ...(app.smoke ? [app.smoke] : [])]) {
        expect(existsSync(join(target, path)), `${name} reads ${path}`).toBe(true);
      }
    }
  });

  it('puts the shared block of CLAUDE.md in the product unchanged, with the layout of the chosen starters only', () => {
    const source = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');
    const block = source.slice(source.indexOf('<!-- shared:begin'), source.indexOf('<!-- shared:end -->') + '<!-- shared:end -->'.length);
    const product = readFileSync(join(target, 'CLAUDE.md'), 'utf8');
    expect(product.startsWith('# widgets\n')).toBe(true);
    expect(product).toContain(block);
    expect(product.split('<!-- shared:begin').length).toBe(2);
    for (const [key, starter] of Object.entries(catalogue.starters)) {
      const dir = project.apps[starter.app]!.path;
      expect(product.includes(`\`${dir}/CLAUDE.md\``), `${key} row`).toBe(chosen.includes(key));
    }
  });

  it("names the product in the root manifests, and in nothing else of the base's name", () => {
    expect(JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')).name).toBe('widgets');
    if (chosen.includes('node-react')) {
      const lock = JSON.parse(readFileSync(join(target, 'package-lock.json'), 'utf8'));
      expect(lock.name).toBe('widgets');
      expect(lock.packages[''].name).toBe('widgets');
    } else {
      expect(onDisk).not.toContain('package-lock.json');
    }
  });

  it('keeps executable bits', () => {
    for (const script of ['apps/api/smoke.sh', 'apps/web/smoke.sh']) {
      if (!onDisk.includes(script)) continue;
      expect(statSync(join(target, script)).mode & 0o111, script).toBe(statSync(join(ROOT, script)).mode & 0o111);
    }
  });

  it("writes a dependabot.yml with the ecosystems the product has: uv only with a Python app", () => {
    const written = readFileSync(join(target, '.github/dependabot.yml'), 'utf8');
    // Read with a pattern of its own, not with the splitter that wrote it.
    const ecosystems = [...written.matchAll(/^ {2}- package-ecosystem: (\S+)$/gm)].map((m) => m[1]);
    const hasPython = chosen.includes('python-fastapi');
    expect(ecosystems).toEqual(['github-actions', 'npm', ...(hasPython ? ['uv'] : [])]);
    if (!hasPython) expect(written).not.toMatch(/uv-minor-patch|directories:/);
    // Every kept entry is the base's own text, so the configuration is written once.
    const base = readFileSync(join(ROOT, '.github/dependabot.yml'), 'utf8');
    for (const entry of written.split(/^(?= {2}- package-ecosystem: )/m).slice(1)) expect(base, entry).toContain(entry.trimEnd());
    expect(written.startsWith('version: 2\n')).toBe(true);
    expect(written.endsWith('\n')).toBe(true);
  });

  // Timeout: assemble lists the source's files with git ls-files before it refuses (<=110 ms quiet); 15 s.
  it('refuses to assemble into what it just built', { timeout: 15_000 }, () => {
    expect(() => assemble({ target, name: 'widgets', starters: chosen, engineCommit: ENGINE_COMMIT })).toThrow(/is not empty/);
    expect(listing(target)).toEqual(onDisk);
  });

  it('has a root package.json with workspaces only when there are apps, and no script that needs them otherwise', () => {
    const manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')) as { workspaces?: string[]; scripts: Record<string, string> };
    const base = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { workspaces: string[]; scripts: Record<string, string> };
    if (chosen.length > 0) {
      expect(manifest.workspaces).toEqual(base.workspaces);
      expect(manifest.scripts).toEqual(base.scripts);
    } else {
      // npm fails ("No workspaces found!") on `--workspaces` with none, so those scripts go, and the rest stay.
      expect(manifest).not.toHaveProperty('workspaces');
      expect(Object.values(manifest.scripts).filter((command) => command.includes('--workspaces'))).toEqual([]);
      expect(manifest.scripts).toEqual(Object.fromEntries(Object.entries(base.scripts).filter(([, command]) => !command.includes('--workspaces'))));
      expect(manifest.scripts['verify']).toBe(base.scripts['verify']);
      expect(manifest.scripts['verify:harness']).toBe(base.scripts['verify:harness']);
      expect(manifest.scripts['verify:apps']).toBe(base.scripts['verify:apps']);
    }
  });

  it('has no apps directory when no starter brings one', () => {
    expect(onDisk.some((f) => f.startsWith('apps/'))).toBe(chosen.length > 0);
    if (chosen.length === 0) {
      const written = JSON.parse(readFileSync(join(target, 'project.json'), 'utf8')) as { apps: unknown; engine: unknown };
      expect(written.apps).toEqual({});
      expect(written.engine).toEqual({ commit: ENGINE_COMMIT });
      // The Layout table has no starter rows, and is still one table: no blank line splits it.
      const product = readFileSync(join(target, 'CLAUDE.md'), 'utf8');
      expect(product).toContain('a shared engine and no starter');
      expect(product).not.toMatch(/\| --- \| --- \|\n\n/);
      expect(product).toMatch(/\| Path \| Holds \|\n\| --- \| --- \|\n\| `project\.json` \|/);
      expect(readFileSync(join(target, 'README.md'), 'utf8')).toContain('the engine alone, with no starter');
    }
  });
});

describe('the committed starters stand alone', () => {
  it('moved the docs-site skill under the web starter, and left no copy behind', () => {
    expect(existsSync(join(ROOT, 'apps/web/.claude/skills/docs-site/SKILL.md'))).toBe(true);
    expect(existsSync(join(ROOT, 'apps/.claude/skills/docs-site'))).toBe(false);
    for (const key of ['api', 'web']) expect(existsSync(join(ROOT, 'apps', key, 'CLAUDE.md')), key).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// A small repository of its own: every refusal, and what is never copied
// ---------------------------------------------------------------------------

const CLAUDE_MD = '# base\n\nintro\n\n<!-- shared:begin — x -->\n\n## Rules\n\n- one\n\n<!-- shared:end -->\n\n## Per repository\n';

function fakeCatalogue(): Catalogue {
  return {
    ignoredNames: ['node_modules'],
    engine: { description: 'e', paths: ['tools'] },
    seeded: { description: 's', paths: ['settings.json'] },
    generated: { description: 'g', paths: ['CLAUDE.md', 'README.md', 'package.json', 'project.json'] },
    base: { description: 'b', paths: ['catalogue.json', 'tools/base-only.txt'] },
    starters: {
      svc: { description: 'A service.', app: 'svc', files: [], build: ['apps/svc/out'] },
    },
    providers: { cloud: { description: 'c', path: 'tools/cloud', template: 'tools/cloud/template' } },
  };
}

function fakeRepo(change: (c: Catalogue) => void = () => undefined, git = true): { root: string; catalogue: Catalogue } {
  const root = scratch();
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  put('project.json', JSON.stringify({
    $comment: 'c',
    name: 'base',
    apps: {
      svc: {
        path: 'apps/svc',
        toolchain: 'python',
        verify: ['true'],
        reads: ['apps/svc'],
        deploy: { provider: 'vercel', team: 't', project: 'p', url: 'https://x.example', commitEndpoint: '/health' },
      },
    },
  }));
  put('package.json', JSON.stringify({ name: 'base', private: true }));
  put('CLAUDE.md', CLAUDE_MD);
  put('settings.json', '{}');
  put('tools/a.mjs', 'a');
  put('tools/deep/b.mjs', 'b');
  put('tools/base-only.txt', 'no');
  put('tools/cloud/template/t', 't');
  put('tools/node_modules/dep/index.js', 'junk');
  put('tools/.env', 'SECRET=1');
  put('tools/.env.production.local', 'SECRET=2');
  put('apps/svc/main.py', 'm');
  put('apps/svc/out/built.txt', 'built');
  put('apps/svc/node_modules/x', 'junk');
  const catalogue = fakeCatalogue();
  change(catalogue);
  writeFileSync(join(root, 'catalogue.json'), JSON.stringify(catalogue));
  if (git) {
    // Local only: the index is all assemble reads.
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['add', '-A', '--force'], { cwd: root });
  }
  return { root, catalogue };
}

function build(change?: (c: Catalogue) => void, overrides: Partial<Parameters<typeof assemble>[0]> = {}) {
  const { root, catalogue } = fakeRepo(change);
  const target = join(scratch(), 'out');
  return { root, target, run: () => assemble({ root, catalogue, target, name: 'prod', starters: ['svc'], ...overrides }) };
}

describe('assemble in a small repository', () => {
  // Timeout: builds a fake repository with real git init and add (<=110 ms quiet); 15 s.
  it('copies the engine and the chosen starter, generates the rest, and nothing else', { timeout: 15_000 }, () => {
    const { target, run } = build();
    run();
    expect(listing(target)).toEqual([
      'CLAUDE.md',
      'README.md',
      'apps/svc/main.py',
      'package.json',
      'project.json',
      'settings.json',
      'tools/a.mjs',
      'tools/cloud/template/t',
      'tools/deep/b.mjs',
    ]);
  });

  // Timeout: builds a fake repository with real git init and add (<=110 ms quiet); 15 s.
  it('never copies a local secret, an ignored name, build output or a base-only file', { timeout: 15_000 }, () => {
    const { target, run } = build();
    run();
    const files = listing(target);
    expect(files.filter((f) => /\.env|node_modules|built\.txt|base-only/.test(f))).toEqual([]);
  });

  // Timeout: builds a fake repository with real git init and add (<=110 ms quiet); 15 s.
  it("writes the product's own project.json: its name, only the chosen app, and no deployment of the base's", { timeout: 15_000 }, () => {
    const { target, run } = build();
    run();
    const written = JSON.parse(readFileSync(join(target, 'project.json'), 'utf8'));
    expect(written.name).toBe('prod');
    expect(written.apps.svc.deploy).toBeUndefined();
    expect(written.apps.svc.path).toBe('apps/svc');
    expect(JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')).name).toBe('prod');
  });

  // Timeout: builds a fake repository with real git init and add (<=110 ms quiet); 15 s.
  it("records the engine's commit as engine.commit in the product's project.json, and only when it is given", { timeout: 15_000 }, () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const withSha = build(undefined, { engineCommit: sha });
    withSha.run();
    const written = loadProject(join(withSha.target, 'project.json'));
    expect(written.engine).toEqual({ commit: sha });
    // Read back as raw JSON too, so the test does not lean on the loader it is checking.
    expect(JSON.parse(readFileSync(join(withSha.target, 'project.json'), 'utf8')).engine).toEqual({ commit: sha });

    const without = build();
    without.run();
    expect(JSON.parse(readFileSync(join(without.target, 'project.json'), 'utf8')).engine).toBeUndefined();
  });

  // Timeout: builds a fake repository with real git init and add (<=110 ms quiet); 15 s.
  it('assembles an engine-only product when no starter is chosen, and the engine commit marks it as one', { timeout: 15_000 }, () => {
    const { target, run } = build(undefined, { starters: [], engineCommit: ENGINE_COMMIT });
    run();
    expect(listing(target)).toEqual(['CLAUDE.md', 'README.md', 'package.json', 'project.json', 'settings.json', 'tools/a.mjs', 'tools/cloud/template/t', 'tools/deep/b.mjs']);
    const written = loadProject(join(target, 'project.json'));
    expect(written.apps).toEqual({});
    expect(written.engine).toEqual({ commit: ENGINE_COMMIT });
    // Without the commit it is not a product, and an empty `apps` is refused, writing nothing.
    const bare = build(undefined, { starters: [] });
    expect(bare.run).toThrow(/"apps" must declare at least one app/);
    expect(existsSync(bare.target)).toBe(false);
    // Starters must still be a list.
    expect(build(undefined, { starters: undefined as never }).run).toThrow(/starters must be a list/);
  });

  // Timeout: builds a fake repository with real git init and add (<=110 ms quiet); 15 s.
  it('refuses an engine commit that is not a full SHA before writing anything', { timeout: 15_000 }, () => {
    for (const engineCommit of ['abc1234', 'main', '', 'Z'.repeat(40)]) {
      const { target, run } = build(undefined, { engineCommit });
      expect(run, engineCommit).toThrow(/engine\.commit/);
      expect(existsSync(target), engineCommit).toBe(false);
    }
  });

  // Timeout: builds a fake repository with real git init and add (<=110 ms quiet); 15 s.
  it('copies committed files only: an untracked file in an engine path or a starter never reaches a product', { timeout: 15_000 }, () => {
    const { root, target, run } = build();
    for (const path of ['tools/.env.production', 'tools/stray.pem', 'tools/deep/notes.txt', 'apps/svc/key.pem']) {
      writeFileSync(join(root, path), 'untracked');
    }
    run();
    expect(listing(target).filter((f) => /env\.production|\.pem|notes\.txt/.test(f))).toEqual([]);
    expect(listing(target)).toContain('tools/a.mjs');
  });

  // Timeout: builds a fake repository with real git init and add (<=110 ms quiet); 15 s.
  it('keeps the name filter as a second guard: a committed local override is still not copied', { timeout: 15_000 }, () => {
    const { root, target, run } = build();
    writeFileSync(join(root, 'tools/.env.local'), 'x');
    execFileSync('git', ['add', '--force', 'tools/.env.local'], { cwd: root });
    run();
    expect(listing(target).filter((f) => f.includes('.env'))).toEqual([]);
  });

  // Timeout: builds a fake repository with real git init and add (<=110 ms quiet); 15 s.
  it('refuses a committed file that is missing from the working tree, naming it', { timeout: 15_000 }, () => {
    const { root, target, run } = build();
    rmSync(join(root, 'tools/deep/b.mjs'));
    expect(run).toThrow(/"tools\/deep\/b\.mjs" is tracked but missing from the working tree/);
    expect(existsSync(target)).toBe(false);
  });

  // Timeout: builds a fake repository with real git init and add (<=110 ms quiet); 15 s.
  it('lists the source root\'s own repository even when the environment points git elsewhere', { timeout: 15_000 }, () => {
    const { root, catalogue } = fakeRepo();
    // A different repository entirely: this one, whose files share nothing with the fake.
    const saved = { GIT_DIR: process.env['GIT_DIR'], GIT_WORK_TREE: process.env['GIT_WORK_TREE'], GIT_INDEX_FILE: process.env['GIT_INDEX_FILE'] };
    const elsewhere = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: ROOT, encoding: 'utf8' }).trim();
    process.env['GIT_DIR'] = elsewhere;
    process.env['GIT_WORK_TREE'] = ROOT;
    process.env['GIT_INDEX_FILE'] = join(elsewhere, 'index');
    try {
      const { entries } = plan({ root, catalogue, name: 'p', starters: ['svc'] });
      expect(entries.map((e) => e.to)).toContain('tools/a.mjs');
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  // Timeout: builds a fake repository and asks git about it, which fails (<=110 ms quiet); 15 s.
  it('says so when the source is not a git checkout, rather than guess at its files', { timeout: 15_000 }, () => {
    const { root, catalogue } = fakeRepo(undefined, false);
    const target = join(scratch(), 'out');
    expect(() => assemble({ root, catalogue, target, name: 'p', starters: ['svc'] })).toThrow(/is not a git checkout/);
    expect(existsSync(target)).toBe(false);
  });

  // Timeout: builds a fake repository with real git init and add (<=110 ms quiet); 15 s.
  it('refuses a target that has anything in it, and leaves it as it was', { timeout: 15_000 }, () => {
    const { target, run } = build();
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'keep.txt'), 'mine');
    expect(run).toThrow(/is not empty/);
    expect(listing(target)).toEqual(['keep.txt']);
  });

  // Timeout: builds a fake repository with real git init and add (<=110 ms quiet); 15 s.
  it('accepts an empty existing directory, and refuses a file or a target inside the source', { timeout: 15_000 }, () => {
    const empty = build();
    mkdirSync(empty.target, { recursive: true });
    expect(() => empty.run()).not.toThrow();

    const file = build();
    writeFileSync(file.target, 'x');
    expect(file.run).toThrow(/is not a directory/);

    const inside = fakeRepo();
    expect(() => assemble({ root: inside.root, catalogue: inside.catalogue, target: join(inside.root, 'out'), name: 'p', starters: ['svc'] })).toThrow(
      /inside the source tree/,
    );
  });

  // Timeout: builds a fake repository with real git init and add (<=110 ms quiet); 15 s.
  it('refuses a target in a directory whose name merely starts with two dots, and one reached through a symbolic link', { timeout: 15_000 }, () => {
    const odd = fakeRepo();
    mkdirSync(join(odd.root, '..x'));
    expect(() => assemble({ root: odd.root, catalogue: odd.catalogue, target: join(odd.root, '..x', 'out'), name: 'p', starters: ['svc'] })).toThrow(
      /inside the source tree/,
    );
    expect(existsSync(join(odd.root, '..x', 'out'))).toBe(false);

    const linked = fakeRepo();
    mkdirSync(join(linked.root, 'sub'));
    const elsewhere = scratch();
    symlinkSync(join(linked.root, 'sub'), join(elsewhere, 'link'));
    expect(() => assemble({ root: linked.root, catalogue: linked.catalogue, target: join(elsewhere, 'link', 'out'), name: 'p', starters: ['svc'] })).toThrow(
      /inside the source tree/,
    );
    expect(existsSync(join(linked.root, 'sub', 'out'))).toBe(false);
  });

  // Timeout: builds a fake repository with real git init and add (<=110 ms quiet); 15 s.
  it('accepts a target beside the source whose own name starts with two dots', { timeout: 15_000 }, () => {
    const { root, catalogue } = fakeRepo();
    const target = join(dirname(root), `..${basename(root)}-product`);
    made.push(target);
    expect(() => assemble({ root, catalogue, target, name: 'p', starters: ['svc'] })).not.toThrow();
  });

  // Timeout: builds a fake repository with real git init and add (<=110 ms quiet); 15 s.
  it('refuses before writing anything: an unknown starter, none, a repeat, or a bad name', { timeout: 15_000 }, () => {
    for (const [overrides, message] of [
      [{ starters: ['nope'] }, /no starter named "nope"/],
      [{ starters: [], engineCommit: undefined }, /"apps" must declare at least one app/],
      [{ starters: ['svc', 'svc'] }, /chosen twice/],
      [{ name: 'Bad Name' }, /name "Bad Name"/],
      [{ name: '../x' }, /name "\.\.\/x"/],
    ] as const) {
      const { target, run } = build(undefined, overrides as never);
      expect(run, String(message)).toThrow(message);
      expect(existsSync(target), String(message)).toBe(false);
    }
  });

  // Timeout: builds a fake repository with real git init and add (<=110 ms quiet); 15 s.
  it('refuses a catalogue that names a path that is not there, or an app project.json lacks', { timeout: 15_000 }, () => {
    const missing = build((c) => c.engine.paths.push('tools/nothing'));
    expect(missing.run).toThrow(/"tools\/nothing" does not exist/);
    expect(existsSync(missing.target)).toBe(false);

    const noApp = build((c) => {
      c.starters['svc']!.app = 'ghost';
    });
    expect(noApp.run).toThrow(/names app "ghost"/);
  });

  // Timeout: builds a fake repository with real git init and add (<=110 ms quiet); 15 s.
  it('refuses a symbolic link rather than follow it', { timeout: 15_000 }, () => {
    const { root, target, run } = build();
    symlinkSync('/etc', join(root, 'tools/link'));
    execFileSync('git', ['add', 'tools/link'], { cwd: root });
    expect(run).toThrow(/"tools\/link" is a symbolic link/);
    expect(existsSync(target)).toBe(false);
  });

  // Timeout: builds a fake repository with real git init and add (<=110 ms quiet); 15 s.
  it('stops at its ceilings, saying which', { timeout: 15_000 }, () => {
    const files = build();
    expect(() => plan({ root: files.root, catalogue: loadFake(files.root), name: 'p', starters: ['svc'], limits: { depth: LIMITS.depth, files: 3 } })).toThrow(
      /more than 3 files/,
    );
    const deep = build();
    expect(() => plan({ root: deep.root, catalogue: loadFake(deep.root), name: 'p', starters: ['svc'], limits: { depth: 0, files: LIMITS.files } })).toThrow(
      /deeper than 0 levels/,
    );
  });

  // Timeout: builds a fake repository with real git init and add (<=110 ms quiet); 15 s.
  it('refuses two sources for one file', { timeout: 15_000 }, () => {
    const { run } = build((c) => {
      c.starters['svc']!.files.push('tools/a.mjs');
    });
    expect(run).toThrow(/"tools\/a\.mjs" would be written twice/);
  });

  // Timeout: builds a fake repository with real git init and add (<=110 ms quiet); 15 s.
  it('refuses a generated file it has no generator for', { timeout: 15_000 }, () => {
    const { run } = build((c) => c.generated.paths.push('NOTES.md'));
    expect(run).toThrow(/no generator for it/);
  });

  // Timeout: builds a fake repository with real git init and add (<=110 ms quiet); 15 s.
  it("refuses an app that reads or smoke-tests something the product would not have", { timeout: 15_000 }, () => {
    const { root, catalogue } = fakeRepo();
    const manifest = JSON.parse(readFileSync(join(root, 'project.json'), 'utf8'));
    manifest.apps.svc.reads.push('docs');
    writeFileSync(join(root, 'project.json'), JSON.stringify(manifest));
    expect(() => plan({ root, catalogue, name: 'p', starters: ['svc'] })).toThrow(/app "svc" \(starter svc\) reads "docs"/);
  });

  // Timeout: builds a fake repository with real git init and add (<=110 ms quiet); 15 s.
  it("drops an app's read of a base-only file from the product's project.json, rather than refusing or shipping a stand-in", { timeout: 15_000 }, () => {
    const { root, catalogue } = fakeRepo();
    const manifest = JSON.parse(readFileSync(join(root, 'project.json'), 'utf8'));
    manifest.apps.svc.reads.push('tools/base-only.txt');
    writeFileSync(join(root, 'project.json'), JSON.stringify(manifest));
    const { entries, project } = plan({ root, catalogue, name: 'p', starters: ['svc'] });
    expect(project.apps['svc']!.reads).toEqual(['apps/svc']);
    expect(entries.map((e: { to: string }) => e.to)).not.toContain('tools/base-only.txt');
  });

  // Timeout: builds a fake repository with real git init and add (<=110 ms quiet); 15 s.
  it('refuses a CLAUDE.md with no shared block', { timeout: 15_000 }, () => {
    const { root, catalogue } = fakeRepo();
    writeFileSync(join(root, 'CLAUDE.md'), '# base\n');
    expect(() => plan({ root, catalogue, name: 'p', starters: ['svc'] })).toThrow(/no <!-- shared:begin/);
    expect(() => sharedBlock('<!-- shared:end -->\n<!-- shared:begin')).toThrow(/no <!-- shared:begin/);
  });
});

function loadFake(root: string): Catalogue {
  return JSON.parse(readFileSync(join(root, 'catalogue.json'), 'utf8')) as Catalogue;
}

const DEPENDABOT = [
  'version: 2',
  '# header comment',
  'updates:',
  '  - package-ecosystem: github-actions',
  '    directory: /',
  '    # inside the entry',
  '    schedule:',
  '      interval: weekly',
  '',
  '  - package-ecosystem: npm',
  '    directory: /',
  '',
  '  - package-ecosystem: uv',
  '    directories:',
  "      - '/apps/*'",
  '',
].join('\n');

describe('dependabotYml', () => {
  it('keeps the entries of the ecosystems the product has, byte for byte, and drops uv without Python', () => {
    const withPython = dependabotYml(DEPENDABOT, { python: true });
    expect(withPython).toBe(DEPENDABOT);
    const without = dependabotYml(DEPENDABOT, { python: false });
    expect(without).toBe(DEPENDABOT.slice(0, DEPENDABOT.indexOf('  - package-ecosystem: uv')).trimEnd() + '\n');
    expect(without).toContain('# header comment');
    expect(without).toContain('    # inside the entry');
    expect(without).not.toContain('uv');
  });

  it('refuses an entry for an ecosystem it does not know, rather than keep or drop it unseen', () => {
    const pip = `${DEPENDABOT}  - package-ecosystem: pip\n    directory: /\n`;
    expect(() => dependabotYml(pip, { python: true })).toThrow(/entry for "pip", and assemble\.mjs does not know/);
  });

  it('refuses a file lacking an entry the product needs', () => {
    const noNpm = DEPENDABOT.replace('  - package-ecosystem: npm\n    directory: /\n\n', '');
    expect(() => dependabotYml(noNpm, { python: false })).toThrow(/no "npm" entry/);
    const noUv = DEPENDABOT.slice(0, DEPENDABOT.indexOf('  - package-ecosystem: uv'));
    expect(() => dependabotYml(noUv, { python: true })).toThrow(/no "uv" entry/);
    expect(dependabotYml(noUv, { python: false })).toContain('github-actions');
  });
});

describe('splitDependabot', () => {
  it('splits at the top-level entries, keeping the comments in each', () => {
    const { header, entries } = splitDependabot(DEPENDABOT);
    expect(header).toEqual(['version: 2', '# header comment', 'updates:']);
    expect(entries.map((e: { ecosystem: string }) => e.ecosystem)).toEqual(['github-actions', 'npm', 'uv']);
    expect(entries[0]!.lines).toContain('    # inside the entry');
  });

  it('throws on what it does not understand rather than dropping it', () => {
    expect(() => splitDependabot(DEPENDABOT.replace('updates:', 'registries:\n  x: y\nupdates:'))).toThrow(/"registries:" before "updates:"/);
    expect(() => splitDependabot('version: 2\n')).toThrow(/exactly one top-level "updates:"/);
    expect(() => splitDependabot('updates:\nupdates:\n')).toThrow(/exactly one top-level "updates:"/);
    expect(() => splitDependabot(`${DEPENDABOT}other: 1\n`)).toThrow(/"other: 1", which assemble\.mjs does not understand/);
    expect(() => splitDependabot(`${DEPENDABOT}  - directory: /\n`)).toThrow(/does not understand/);
    expect(() => splitDependabot('version: 2\nupdates:\n    directory: /\n')).toThrow(/before the first "- package-ecosystem:" entry/);
    // A comment outside any entry cannot be placed: dropped before the first entry, or glued to the previous one if kept.
    expect(() => splitDependabot(DEPENDABOT.replace('updates:\n', 'updates:\n  # about github-actions\n'))).toThrow(/" {2}# about github-actions", a comment before the first entry/);
    expect(() => splitDependabot(DEPENDABOT.replace('  - package-ecosystem: uv', '  # about uv\n  - package-ecosystem: uv'))).toThrow(
      /" {2}# about uv", a comment between entries/,
    );
    expect(() => splitDependabot(`${DEPENDABOT}# trailing\n`)).toThrow(/"# trailing", a comment between entries/);
    expect(() => splitDependabot('version: 2\nupdates:\n')).toThrow(/no "- package-ecosystem:" entries/);
    expect(() => splitDependabot(DEPENDABOT.replace('      interval: weekly', '\tinterval: weekly'))).toThrow(/tab/);
  });
});

describe('a product built from a repository whose engine holds .github but not its dependabot.yml', () => {
  /** The small repository, with a .github directory in the engine and the base's dependabot.yml generated per product. */
  function withGithub(toolchain: 'python' | 'node', file = DEPENDABOT) {
    const { root, catalogue } = fakeRepo((c) => {
      c.engine.paths.push('.github');
      c.generated.paths.push('.github/dependabot.yml');
    });
    const manifest = JSON.parse(readFileSync(join(root, 'project.json'), 'utf8'));
    manifest.apps.svc.toolchain = toolchain;
    writeFileSync(join(root, 'project.json'), JSON.stringify(manifest));
    mkdirSync(join(root, '.github/workflows'), { recursive: true });
    writeFileSync(join(root, '.github/workflows/verify.yml'), 'name: verify\n');
    writeFileSync(join(root, '.github/dependabot.yml'), file);
    execFileSync('git', ['add', '-A', '--force'], { cwd: root });
    const target = join(scratch(), 'out');
    return { root, target, run: () => assemble({ root, catalogue, target, name: 'prod', starters: ['svc'] }) };
  }

  // Timeout: builds a fake repository with real git init and add (<=110 ms quiet); 15 s.
  it('keeps the rest of .github, and writes the dependabot.yml once, without uv for a product with no Python app', { timeout: 15_000 }, () => {
    const { target, run } = withGithub('node');
    const { files } = run();
    expect(files.filter((f: string) => f.startsWith('.github/'))).toEqual(['.github/dependabot.yml', '.github/workflows/verify.yml']);
    const written = readFileSync(join(target, '.github/dependabot.yml'), 'utf8');
    expect(written).toContain('package-ecosystem: npm');
    expect(written).not.toContain('uv');
  });

  // Timeout: builds a fake repository with real git init and add (<=110 ms quiet); 15 s.
  it('keeps the uv entry for a product with a Python app', { timeout: 15_000 }, () => {
    const { target, run } = withGithub('python');
    run();
    expect(readFileSync(join(target, '.github/dependabot.yml'), 'utf8')).toBe(DEPENDABOT);
  });

  // Timeout: builds a fake repository with real git add (<=110 ms quiet); 15 s.
  it('refuses, writing nothing, when the base\'s dependabot.yml is a shape it cannot split', { timeout: 15_000 }, () => {
    const { target, run } = withGithub('node', `${DEPENDABOT}registries:\n  x: y\n`);
    expect(run).toThrow(/"registries:", which assemble\.mjs does not understand/);
    expect(existsSync(target)).toBe(false);
  });
});

describe('sharedBlock', () => {
  it('the rule that no turn ends with a question survives in the shared block (#325)', () => {
    const block = sharedBlock(readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8'));
    expect(block.replace(/\s+/g, ' ').toLowerCase()).toContain('no turn ends with a question');
  });

  it('returns the markers and everything between them, and nothing outside', () => {
    expect(sharedBlock(CLAUDE_MD)).toBe('<!-- shared:begin — x -->\n\n## Rules\n\n- one\n\n<!-- shared:end -->');
  });
});

describe('under', () => {
  it('matches a path or what lies beneath it, never a name that merely starts the same', () => {
    expect(under('scripts', 'scripts')).toBe(true);
    expect(under('scripts', 'scripts/a.mjs')).toBe(true);
    expect(under('scripts', 'scripts-extra/a.mjs')).toBe(false);
  });
});

describe('the command line', () => {
  it('parses its flags and rejects the rest', () => {
    expect(parseArgs(['--target', 'd', '--name', 'n', '--starter', 'a', '--starter', 'b'])).toEqual({ target: 'd', name: 'n', starters: ['a', 'b'] });
    expect(parseArgs(['--target', 'd', '--name', 'n', '--starter', 'a', '--engine-commit', 'abc'])).toEqual({
      target: 'd',
      name: 'n',
      starters: ['a'],
      engineCommit: 'abc',
    });
    expect(parseArgs(['--list'])).toEqual({ list: true, starters: [] });
    expect(() => parseArgs(['--engine-commit'])).toThrow(/needs a value/);
    expect(() => parseArgs(['--target'])).toThrow(/needs a value/);
    expect(() => parseArgs(['--bogus'])).toThrow(/unknown argument "--bogus"/);
  });

  // Timeout: spawns node scripts/assemble.mjs six times (367 ms quiet); 30 s.
  it('lists the starters and providers, builds a tree, and exits non-zero on a refusal', { timeout: 30_000 }, () => {
    const listed = spawnSync('node', ['scripts/assemble.mjs', '--list'], { cwd: ROOT, encoding: 'utf8' });
    expect(listed.status).toBe(0);
    expect(listed.stdout).toMatch(/starter {2}python-fastapi: /);
    expect(listed.stdout).toMatch(/provider vercel: /);

    const target = join(scratch(), 'cli');
    const built = spawnSync('node', ['scripts/assemble.mjs', '--target', target, '--name', 'cli-product', '--starter', 'python-fastapi'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(built.status).toBe(0);
    expect(existsSync(join(target, 'apps/api/pyproject.toml'))).toBe(true);

    const sha = 'f'.repeat(40);
    const recorded = join(scratch(), 'cli-recorded');
    const withSha = spawnSync(
      'node',
      ['scripts/assemble.mjs', '--target', recorded, '--name', 'cli-product', '--starter', 'python-fastapi', '--engine-commit', sha],
      { cwd: ROOT, encoding: 'utf8' },
    );
    expect(withSha.status).toBe(0);
    expect(JSON.parse(readFileSync(join(recorded, 'project.json'), 'utf8')).engine).toEqual({ commit: sha });

    const badSha = spawnSync(
      'node',
      ['scripts/assemble.mjs', '--target', join(scratch(), 'cli-bad'), '--name', 'cli-product', '--starter', 'python-fastapi', '--engine-commit', 'abc'],
      { cwd: ROOT, encoding: 'utf8' },
    );
    expect(badSha.status).toBe(1);
    expect(badSha.stderr).toMatch(/engine\.commit/);

    const bare = join(scratch(), 'cli-engine-only');
    const engineOnly = spawnSync('node', ['scripts/assemble.mjs', '--target', bare, '--name', 'cli-product', '--engine-commit', sha], { cwd: ROOT, encoding: 'utf8' });
    expect(engineOnly.status).toBe(0);
    expect(existsSync(join(bare, 'apps'))).toBe(false);
    expect(JSON.parse(readFileSync(join(bare, 'project.json'), 'utf8')).apps).toEqual({});
    const noCommit = spawnSync('node', ['scripts/assemble.mjs', '--target', join(scratch(), 'cli-no-commit'), '--name', 'cli-product'], { cwd: ROOT, encoding: 'utf8' });
    expect(noCommit.status).toBe(1);
    expect(noCommit.stderr).toMatch(/at least one app/);

    const again = spawnSync('node', ['scripts/assemble.mjs', '--target', target, '--name', 'cli-product', '--starter', 'python-fastapi'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(again.status).toBe(1);
    expect(again.stderr).toMatch(/is not empty/);
  });
});

// Keep the helper honest: `listing` is the test's own reader of a tree.
describe('listing', () => {
  it('reads relative paths from disk', () => {
    const dir = scratch();
    mkdirSync(join(dir, 'a'));
    writeFileSync(join(dir, 'a/b.txt'), '');
    expect(listing(dir)).toEqual(['a/b.txt']);
    expect(relative(dir, join(dir, 'a'))).toBe('a');
  });
});

// ---------------------------------------------------------------------------
// A product has to pass its own harness (#281)
//
// Everything above checks an assembled tree's shape. None of it ran the tree's
// own test suite, so base-only assumptions in shared tests (a file only the
// base has, the base's name inside a product's name) shipped green and failed
// the owner's first real `create`. This assembles, commits, and runs it.
// ---------------------------------------------------------------------------
describe("an assembled product passes its own harness (#281)", () => {
  // The base's own name plus a suffix, as the owner's first `create` was. Built
  // from parts so this file does not itself name it, as identity.test.ts reads it.
  const BASE_NAMED_PRODUCT = `${'bor'}is-trial`;

  /** Assembles, commits and runs the product's own `verify:harness`; returns the exit status and the tail of its output. */
  const harness = (name: string, starters: string[], addLater = false) => {
    const target = join(scratch(), 'product');
    assemble({ target, name, starters: addLater ? [] : starters, engineCommit: ENGINE_COMMIT });
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: target, encoding: 'utf8', stdio: 'pipe' });
    git('init', '-q');
    git('add', '-A');
    git('commit', '-q', '-m', 'assembled');
    if (addLater) {
      // The starters arrive through `setup add` (#288), from a clone of this checkout standing in for the base.
      const base = join(scratch(), 'base');
      execFileSync('git', ['clone', '-q', '--local', ROOT, base], { stdio: 'pipe' });
      const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: base, encoding: 'utf8' }).trim();
      writeFileSync(join(target, 'project.json'), readFileSync(join(target, 'project.json'), 'utf8').replace(ENGINE_COMMIT, sha));
      git('commit', '-q', '-am', 'engine commit');
      git('remote', 'add', `${'bor'}is`, base);
      const added = spawnSync(process.execPath, ['scripts/setup.mjs', 'add', ...starters.flatMap((s) => ['--starter', s])], { cwd: target, encoding: 'utf8', timeout: 120_000 });
      if (added.status !== 0) return { status: added.status, output: `${added.stdout}\n${added.stderr}` };
      git('add', '-A');
      git('commit', '-q', '-m', 'add starters');
    }
    // No install: the product borrows the base's toolchain.
    symlinkSync(join(ROOT, 'node_modules'), join(target, 'node_modules'));
    // The product's own `verify:harness`, in full: tsc and eslint as well as vitest, since a static
    // import of a starter's file passes vitest and fails the typecheck in a product without it.
    const run = spawnSync('npm', ['run', 'verify:harness'], { cwd: target, encoding: 'utf8', timeout: 560_000 });
    return { status: run.status, output: `${run.stdout}\n${run.stderr}`.slice(-6000) };
  };

  // Timeout: assembles a product, git init + commit, then runs its whole `verify:harness` (tsc, eslint, vitest; about a minute quiet, several times that under load); 600 s.
  it("a product whose name contains the base's, with both starters", { timeout: 600_000 }, () => {
    const { status, output } = harness(BASE_NAMED_PRODUCT, ['python-fastapi', 'node-react']);
    expect(status, output).toBe(0);
  });

  // Timeout: as above, 600 s.
  it('an engine-only product given both starters by `setup add`', { timeout: 600_000 }, () => {
    const { status, output } = harness('widgets', ['python-fastapi', 'node-react'], true);
    expect(status, output).toBe(0);
  });

  // Timeout: as above, 600 s.
  it('an engine-only product', { timeout: 600_000 }, () => {
    const { status, output } = harness('widgets', []);
    expect(status, output).toBe(0);
  });
});
