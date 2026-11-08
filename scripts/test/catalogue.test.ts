import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROVIDERS } from '../deploy/index.mjs';
import { GENERATORS, ROOT, loadCatalogue, under, validateCatalogue, type Catalogue } from '../assemble.mjs';
import { loadProject, validate } from '../project.mjs';

const catalogue = loadCatalogue();
const project = loadProject();

/** Every file the repository holds that git would commit: tracked, or new and not ignored. */
function repositoryFiles(): string[] {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

const sample = (): Catalogue => JSON.parse(readFileSync(join(ROOT, 'catalogue.json'), 'utf8')) as Catalogue;

describe('the committed catalogue.json', () => {
  it('declares the engine, both starters and the vercel provider', () => {
    expect(Object.keys(catalogue.starters).sort()).toEqual(['node-react', 'python-fastapi']);
    expect(Object.keys(catalogue.providers)).toEqual(['vercel']);
    expect(catalogue.engine.paths.length).toBeGreaterThan(0);
  });

  it('names only paths that exist', () => {
    const named = [
      ...catalogue.engine.paths,
      ...catalogue.seeded.paths,
      ...catalogue.generated.paths,
      ...catalogue.base.paths,
      ...Object.values(catalogue.starters).flatMap((s) => [...s.files, ...s.build.filter((p) => p !== 'apps/web/public')]),
      ...Object.values(catalogue.providers).flatMap((p) => [p.path, p.template]),
    ];
    expect(named.filter((path) => !existsSync(join(ROOT, path)))).toEqual([]);
  });

  it("points each starter at an app project.json declares, and lets that entry be the app's only copy", () => {
    for (const [key, starter] of Object.entries(catalogue.starters)) {
      const app = project.apps[starter.app];
      expect(app, key).toBeDefined();
      expect(existsSync(join(ROOT, app?.path ?? 'missing')), key).toBe(true);
      // The entry is referenced, never repeated: nothing in a starter restates it.
      expect(Object.keys(starter).sort(), key).toEqual(['app', 'build', 'description', 'files']);
    }
  });

  it("is the base: it records no engine.commit and keeps both apps, so an empty `apps` stays refused here", () => {
    // A product may declare no apps (an engine-only product); the base may not.
    // `validate` tells them apart by engine.commit, which only a product has.
    expect(project.engine).toBeUndefined();
    expect(Object.keys(project.apps).sort()).toEqual(['api', 'web']);
    expect(() => validate({ ...project, apps: {} })).toThrow(/at least one app/);
  });

  // Timeout: spawns git ls-files (13 ms quiet); 15 s.
  it('gives every file in the repository exactly one home', { timeout: 15_000 }, () => {
    const appDirs = Object.values(catalogue.starters).map((s) => project.apps[s.app]?.path ?? '');
    const starterFiles = Object.values(catalogue.starters).flatMap((s) => s.files);
    const elsewhere = [...catalogue.seeded.paths, ...catalogue.generated.paths, ...catalogue.base.paths, ...starterFiles];
    const homeless: string[] = [];
    const crowded: string[] = [];
    for (const file of repositoryFiles()) {
      const specific = [...elsewhere, ...appDirs].filter((prefix) => under(prefix, file));
      const general = catalogue.engine.paths.filter((prefix) => under(prefix, file));
      if (specific.length + general.length === 0) homeless.push(file);
      // The engine may be a directory with a more specific home inside it; no other overlap is allowed.
      if (specific.length > 1 || (general.length > 1)) crowded.push(file);
    }
    expect({ homeless, crowded }).toEqual({ homeless: [], crowded: [] });
  });

  it('keeps providers inside the engine, and in step with the registry the deploy code uses', () => {
    expect(Object.keys(catalogue.providers).sort()).toEqual(Object.keys(PROVIDERS).sort());
    for (const [key, provider] of Object.entries(catalogue.providers)) {
      expect(
        catalogue.engine.paths.some((p) => under(p, provider.path)),
        key,
      ).toBe(true);
      expect(under(provider.path, provider.template), key).toBe(true);
    }
  });

  it('has a generator for every file it says is generated, and none that nothing asks for', () => {
    expect(Object.keys(GENERATORS).sort()).toEqual([...catalogue.generated.paths].sort());
  });

  it('keeps the base-only files the issue names out of the engine', () => {
    for (const path of ['docs/adoption.md', 'index.html', '.claude/trials', 'catalogue.json']) {
      expect(catalogue.base.paths, path).toContain(path);
    }
    expect(catalogue.generated.paths).toContain('docs/data-governance.md');
    expect(catalogue.generated.paths).toContain('project.json');
  });
});

/**
 * References an engine file may keep to a base-only path, one entry per "file -> path", each with its reason.
 * An entry is for a reference that deliberately means the base repository's own copy, never a local file.
 */
const MASTER_COPY_REFERENCES: Record<string, string> = {
  // sync-ai-layer is run against the master: it reads the master's catalogue.json to learn the engine paths,
  // and says so ("from the master's `catalogue.json`"). A product has no copy and is not meant to.
  '.claude/skills/sync-ai-layer/SKILL.md -> catalogue.json': "reads the master's engine.paths",
  // The engine scripts below read, build from, or test catalogue.json / index.html as logic; they run
  // in the base (assemble, setup) or exist only to guard the base's files, and fail loudly elsewhere.
  'scripts/assemble.mjs -> catalogue.json': 'assembler reads the base catalogue',
  'scripts/assemble.mjs -> index.html': 'assembler names the base step-0 page',
  'scripts/project.mjs -> catalogue.json': 'reads the base catalogue',
  'scripts/setup.mjs -> catalogue.json': 'setup runs from the base',
  'scripts/test/identity.test.ts -> catalogue.json': 'identity census allowlist',
  'scripts/test/identity.test.ts -> docs/adoption.md': 'identity census allowlist',
  'scripts/test/identity.test.ts -> index.html': 'identity census allowlist',
  'scripts/test/project.test.ts -> catalogue.json': 'tests project.mjs catalogue handling',
  'scripts/test/review-scope.test.ts -> docs/adoption.md': 'review scope names the base document',
  'scripts/test/setup.test.ts -> catalogue.json': 'tests setup',
  'scripts/test/smoke.test.ts -> index.html': 'smoke fixture',
  'scripts/test/spawn-timeout.test.ts -> catalogue.json': 'names base-only test files',
  'scripts/test/spawn-timeout.test.ts -> scripts/test/assemble.test.ts': 'names base-only test files',
  'scripts/test/spawn-timeout.test.ts -> scripts/test/setup-create.test.ts': 'names base-only test files',
  'scripts/test/test-census.test.ts -> catalogue.json': 'census fixtures',
  'scripts/test/test-census.test.ts -> docs/adoption.md': 'census fixtures',
  'scripts/test/test-census.test.ts -> scripts/test/assemble.test.ts': 'census fixtures',
  'scripts/test/vercel-ignore.test.ts -> index.html': 'vercel-ignore fixture',
  'scripts/test/verify-workflow.test.ts -> catalogue.json': 'workflow fixture',
};

/** True when `path` appears in `text` as a path, not as the tail of a longer one (apps/web/index.html) or a longer word. */
function names(text: string, path: string): boolean {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w./-])${escaped}(?![\\w-])`).test(text);
}

/** Engine files that name a base path, as "file -> path" strings. Base-listed files are exempt: they never ship. */
function engineReferencesToBase(cat: Catalogue, read: (file: string) => string | null, files: string[], allow: Record<string, string> = MASTER_COPY_REFERENCES): string[] {
  const found: string[] = [];
  for (const file of files) {
    if (!cat.engine.paths.some((p) => under(p, file))) continue;
    if (cat.base.paths.some((p) => under(p, file))) continue;
    const text = read(file);
    if (text === null) continue;
    for (const path of cat.base.paths) {
      if (names(text, path) && !(`${file} -> ${path}` in allow)) found.push(`${file} -> ${path}`);
    }
  }
  return found;
}

// This file is itself base-only (catalogue.base.paths), so the scan runs in the base and never downstream.
describe('engine files and base-only paths', () => {
  it('no engine file names a path the catalogue lists under base', { timeout: 15_000 }, () => {
    const read = (file: string) => {
      const buf = readFileSync(join(ROOT, file));
      return buf.includes(0) ? null : buf.toString('utf8'); // skip binary files
    };
    expect(engineReferencesToBase(catalogue, read, repositoryFiles())).toEqual([]);
  });

  it('keeps no allowlist entry that nothing needs any more', { timeout: 15_000 }, () => {
    const read = (file: string) => {
      const buf = readFileSync(join(ROOT, file));
      return buf.includes(0) ? null : buf.toString('utf8');
    };
    const actual = engineReferencesToBase(catalogue, read, repositoryFiles(), {});
    expect(Object.keys(MASTER_COPY_REFERENCES).filter((k) => !actual.includes(k))).toEqual([]);
  });

  it('fails naming the file and the path when an engine file gains such a reference', () => {
    const files = ['docs/sops.md', 'scripts/test/assemble.test.ts'];
    const read = (file: string) => (file === 'docs/sops.md' ? 'see .claude/trials/model-tiering.md' : 'catalogue.json');
    expect(engineReferencesToBase(catalogue, read, files)).toEqual(['docs/sops.md -> .claude/trials']);
  });

  it('catches a reference in a script or a json file, and ignores a longer path that ends the same way', () => {
    const files = ['scripts/x.mjs', 'telemetry/y.json', 'docs/sops.md'];
    const texts: Record<string, string> = {
      'scripts/x.mjs': '// see .claude/trials/model-tiering.md',
      'telemetry/y.json': '{"p": "docs/adoption.md"}',
      'docs/sops.md': 'apps/web/index.html and my-catalogue.json',
    };
    expect(engineReferencesToBase(catalogue, (f) => texts[f] ?? null, files)).toEqual([
      'scripts/x.mjs -> .claude/trials',
      'telemetry/y.json -> docs/adoption.md',
    ]);
  });
});

describe('validateCatalogue', () => {
  it('accepts the committed one', () => {
    expect(() => validateCatalogue(sample())).not.toThrow();
  });

  it('names the field that is wrong', () => {
    const noStarters = sample();
    noStarters.starters = {};
    expect(() => validateCatalogue(noStarters)).toThrow(/"starters" must declare at least one/);

    const escaping = sample();
    escaping.engine.paths.push('../outside');
    expect(() => validateCatalogue(escaping)).toThrow(/engine\.paths has "\.\.\/outside"/);

    const nameless = sample();
    nameless.engine.description = '';
    expect(() => validateCatalogue(nameless)).toThrow(/"engine" needs a description/);

    const badIgnore = sample();
    badIgnore.ignoredNames.push('a/b');
    expect(() => validateCatalogue(badIgnore)).toThrow(/ignoredNames/);
  });

  it('refuses a path with two homes, and one app claimed by two starters', () => {
    const twice = sample();
    twice.base.paths.push('scripts');
    expect(() => validateCatalogue(twice)).toThrow(/"scripts" is declared twice/);

    const shared = sample();
    const web = shared.starters['node-react'];
    if (!web) throw new Error('fixture');
    web.app = 'api';
    expect(() => validateCatalogue(shared)).toThrow(/already another starter's/);
  });
});
