import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROVIDERS } from '../deploy/index.mjs';
import { GENERATORS, ROOT, loadCatalogue, under, validateCatalogue, type Catalogue } from '../assemble.mjs';
import { loadProject } from '../project.mjs';

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

  it('gives every file in the repository exactly one home', () => {
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
