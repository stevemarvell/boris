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
import { dirname, join, relative } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { LIMITS, ROOT, assemble, loadCatalogue, parseArgs, plan, sharedBlock, under, type Catalogue } from '../assemble.mjs';
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
const gitFiles = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' })
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
  for (const s of starters) for (const stub of s.stubs) out.add(stub);
  return [...out].sort();
}

const COMBINATIONS: string[][] = [['python-fastapi'], ['node-react'], ['python-fastapi', 'node-react']];

describe.each(COMBINATIONS)('assembling %s', (...chosen) => {
  const target = join(scratch(), 'product');
  const result = assemble({ target, name: 'widgets', starters: chosen });
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
      'telemetry/.env',
    ]) {
      expect(onDisk, absent).not.toContain(absent);
    }
    expect(onDisk.filter((f) => /(^|\/)(node_modules|dist|\.venv|__pycache__)\//.test(f))).toEqual([]);
  });

  it("replaces the base's own documents with the product's", () => {
    expect(readFileSync(join(target, 'docs/data-governance.md'), 'utf8')).toMatch(/^# Data governance\n\nA stub/);
    expect(readFileSync(join(target, 'docs/data-governance.md'), 'utf8')).not.toBe(readFileSync(join(ROOT, 'docs/data-governance.md'), 'utf8'));
    if (chosen.includes('node-react')) {
      expect(readFileSync(join(target, 'docs/adoption.md'), 'utf8')).not.toBe(readFileSync(join(ROOT, 'docs/adoption.md'), 'utf8'));
      expect(readFileSync(join(target, 'index.html'), 'utf8')).not.toBe(readFileSync(join(ROOT, 'index.html'), 'utf8'));
    } else {
      expect(onDisk).not.toContain('docs/adoption.md');
      expect(onDisk).not.toContain('index.html');
    }
  });

  it("writes a project.json that validates, names the product, and holds only the chosen apps, each as the base declares it", () => {
    const written = loadProject(join(target, 'project.json'));
    expect(written.name).toBe('widgets');
    const apps = chosen.map((key) => catalogue.starters[key]!.app).sort();
    expect(Object.keys(written.apps).sort()).toEqual(apps);
    for (const app of apps) expect(written.apps[app]).toEqual(project.apps[app]);
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

  it('refuses to assemble into what it just built', () => {
    expect(() => assemble({ target, name: 'widgets', starters: chosen })).toThrow(/is not empty/);
    expect(listing(target)).toEqual(onDisk);
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
      svc: { description: 'A service.', app: 'svc', files: [], build: ['apps/svc/out'], stubs: [] },
    },
    providers: { cloud: { description: 'c', path: 'tools/cloud', template: 'tools/cloud/template' } },
  };
}

function fakeRepo(change: (c: Catalogue) => void = () => undefined): { root: string; catalogue: Catalogue } {
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
  return { root, catalogue };
}

function build(change?: (c: Catalogue) => void, overrides: Partial<Parameters<typeof assemble>[0]> = {}) {
  const { root, catalogue } = fakeRepo(change);
  const target = join(scratch(), 'out');
  return { root, target, run: () => assemble({ root, catalogue, target, name: 'prod', starters: ['svc'], ...overrides }) };
}

describe('assemble in a small repository', () => {
  it('copies the engine and the chosen starter, generates the rest, and nothing else', () => {
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

  it('never copies a local secret, an ignored name, build output or a base-only file', () => {
    const { target, run } = build();
    run();
    const files = listing(target);
    expect(files.filter((f) => /\.env|node_modules|built\.txt|base-only/.test(f))).toEqual([]);
  });

  it("writes the product's own project.json: its name, only the chosen app, and no deployment of the base's", () => {
    const { target, run } = build();
    run();
    const written = JSON.parse(readFileSync(join(target, 'project.json'), 'utf8'));
    expect(written.name).toBe('prod');
    expect(written.apps.svc.deploy).toBeUndefined();
    expect(written.apps.svc.path).toBe('apps/svc');
    expect(JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')).name).toBe('prod');
  });

  it('refuses a target that has anything in it, and leaves it as it was', () => {
    const { target, run } = build();
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'keep.txt'), 'mine');
    expect(run).toThrow(/is not empty/);
    expect(listing(target)).toEqual(['keep.txt']);
  });

  it('accepts an empty existing directory, and refuses a file or a target inside the source', () => {
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

  it('refuses before writing anything: an unknown starter, none, a repeat, or a bad name', () => {
    for (const [overrides, message] of [
      [{ starters: ['nope'] }, /no starter named "nope"/],
      [{ starters: [] }, /choose at least one starter/],
      [{ starters: ['svc', 'svc'] }, /chosen twice/],
      [{ name: 'Bad Name' }, /name "Bad Name"/],
      [{ name: '../x' }, /name "\.\.\/x"/],
    ] as const) {
      const { target, run } = build(undefined, overrides as never);
      expect(run, String(message)).toThrow(message);
      expect(existsSync(target), String(message)).toBe(false);
    }
  });

  it('refuses a catalogue that names a path that is not there, or an app project.json lacks', () => {
    const missing = build((c) => c.engine.paths.push('tools/nothing'));
    expect(missing.run).toThrow(/"tools\/nothing" does not exist/);
    expect(existsSync(missing.target)).toBe(false);

    const noApp = build((c) => {
      c.starters['svc']!.app = 'ghost';
    });
    expect(noApp.run).toThrow(/names app "ghost"/);
  });

  it('refuses a symbolic link rather than follow it', () => {
    const { root, target, run } = build();
    symlinkSync('/etc', join(root, 'tools/link'));
    expect(run).toThrow(/"tools\/link" is a symbolic link/);
    expect(existsSync(target)).toBe(false);
  });

  it('stops at its ceilings, saying which', () => {
    const files = build();
    expect(() => plan({ root: files.root, catalogue: loadFake(files.root), name: 'p', starters: ['svc'], limits: { depth: LIMITS.depth, files: 3 } })).toThrow(
      /more than 3 files/,
    );
    const deep = build();
    expect(() => plan({ root: deep.root, catalogue: loadFake(deep.root), name: 'p', starters: ['svc'], limits: { depth: 0, files: LIMITS.files } })).toThrow(
      /deeper than 0 levels/,
    );
  });

  it('refuses two sources for one file', () => {
    const { run } = build((c) => {
      c.starters['svc']!.files.push('tools/a.mjs');
    });
    expect(run).toThrow(/"tools\/a\.mjs" would be written twice/);
  });

  it('refuses a generated file it has no generator for', () => {
    const { run } = build((c) => c.generated.paths.push('NOTES.md'));
    expect(run).toThrow(/no generator for it/);
  });

  it("refuses an app that reads or smoke-tests something the product would not have", () => {
    const { root, catalogue } = fakeRepo();
    const manifest = JSON.parse(readFileSync(join(root, 'project.json'), 'utf8'));
    manifest.apps.svc.reads.push('docs');
    writeFileSync(join(root, 'project.json'), JSON.stringify(manifest));
    expect(() => plan({ root, catalogue, name: 'p', starters: ['svc'] })).toThrow(/app "svc" \(starter svc\) reads "docs"/);
  });

  it('refuses a CLAUDE.md with no shared block', () => {
    const { root, catalogue } = fakeRepo();
    writeFileSync(join(root, 'CLAUDE.md'), '# base\n');
    expect(() => plan({ root, catalogue, name: 'p', starters: ['svc'] })).toThrow(/no <!-- shared:begin/);
    expect(() => sharedBlock('<!-- shared:end -->\n<!-- shared:begin')).toThrow(/no <!-- shared:begin/);
  });
});

function loadFake(root: string): Catalogue {
  return JSON.parse(readFileSync(join(root, 'catalogue.json'), 'utf8')) as Catalogue;
}

describe('sharedBlock', () => {
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
    expect(parseArgs(['--list'])).toEqual({ list: true, starters: [] });
    expect(() => parseArgs(['--target'])).toThrow(/needs a value/);
    expect(() => parseArgs(['--bogus'])).toThrow(/unknown argument "--bogus"/);
  });

  it('lists the starters and providers, builds a tree, and exits non-zero on a refusal', () => {
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
