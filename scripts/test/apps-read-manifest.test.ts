import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The Vercel ignore step and the smoke freshness gate treat the other apps'
// entries in project.json as irrelevant to a build (relevantManifest in
// scripts/project.mjs keeps only the top-level `name` and the app's own entry).
// That holds only while no app's build reads anything else from project.json,
// such as another app's deploy.url. This fails the day one does: widen
// relevantManifest first, then this test.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKIP = new Set(['node_modules', 'dist', 'build', '.venv', '.vercel', '__pycache__', 'coverage', 'test-results', 'playwright-report']);
const SOURCE = /\.(m?[jt]sx?|py)$/;

function* files(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (SOURCE.test(entry)) yield path;
  }
}

describe('apps read nothing but `name` from project.json', () => {
  // An engine-only product has no apps/ yet: nothing to read the manifest.
  const sources = (existsSync(join(ROOT, 'apps')) ? readdirSync(join(ROOT, 'apps')) : [])
    .map((app) => join(ROOT, 'apps', app))
    .filter((dir) => statSync(dir).isDirectory())
    .flatMap((dir) => [...files(dir)])
    .filter((path) => !/\.(test|spec)\.[jt]sx?$/.test(path))
    .map((path) => ({ path, text: readFileSync(path, 'utf8') }))
    .filter(({ text }) => /project\.json|project\.mjs/.test(text));

  it('finds the readers it is meant to police', () => {
    if (!existsSync(join(ROOT, 'apps'))) return;
    expect(sources.some(({ path }) => path.endsWith('vite.config.ts'))).toBe(true);
  });

  it('never reads another field, or loads the manifest through scripts/project.mjs', () => {
    for (const { path, text } of sources) {
      expect(text, `${path} imports project.mjs`).not.toMatch(/project\.mjs/);
      // A destructuring of the parsed manifest may take `name` and nothing else.
      for (const m of text.matchAll(/const\s*\{([^}]*)\}\s*=\s*JSON\.parse\(readFileSync\([^)]*project\.json/g)) {
        const keys = m[1]!.split(',').map((k) => k.trim().split(':')[0]!.trim()).filter(Boolean);
        expect(keys, `${path} destructures ${keys}`).toEqual(['name']);
      }
      // A direct property read must be `.name`.
      for (const m of text.matchAll(/JSON\.parse\(readFileSync\([^)]*project\.json[^)]*\)[^)]*\)\s*\.(\w+)/g)) {
        expect(m[1], `${path} reads .${m[1]}`).toBe('name');
      }
    }
  });
});
