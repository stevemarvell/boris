import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The Vercel ignore step and the smoke freshness gate treat the other apps'
// entries in project.json as irrelevant to a build (relevantManifest in
// scripts/project.mjs keeps only the top-level `name` and the app's own entry).
// That holds only while no app's build reads anything else from project.json,
// such as another app's deploy.url. This fails the day one does: widen
// relevantManifest first, then this test.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKIP = new Set(['node_modules', 'dist', 'build', '.venv', '.vercel', '__pycache__', 'coverage', 'test-results', 'playwright-report', 'public']);
const SOURCE = /\.(m?[jt]sx?|cjs|py|sh|json|ya?ml)$/;

function* files(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (SOURCE.test(entry)) yield path;
  }
}

// Every mention of project.json under apps/ must be one of these exact lines,
// each of which reads only the top-level `name`. Anything else, however it is
// spelled (a split read, a helper, an import), fails until it is reviewed
// against relevantManifest and added here. Comment lines are not reads.
const KNOWN_READS: Record<string, string> = {
  'apps/web/vite.config.ts': "const { name: APP_NAME } = JSON.parse(readFileSync(join(REPO_ROOT, 'project.json'), 'utf8'));",
  'apps/web/scripts/build-docs.mjs': "return JSON.parse(readFileSync(join(root, 'project.json'), 'utf8')).name;",
};
const isComment = (line: string) => /^(\/\/|\*|\/\*|#|<!--)/.test(line);

describe('apps read nothing but `name` from project.json', () => {
  const hasApps = existsSync(join(ROOT, 'apps'));
  const mentions = (hasApps ? readdirSync(join(ROOT, 'apps')) : [])
    .map((app) => join(ROOT, 'apps', app))
    .filter((dir) => statSync(dir).isDirectory())
    .flatMap((dir) => [...files(dir)])
    .filter((path) => !/\.(test|spec)\.[jt]sx?$/.test(path))
    .flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => /project\.(json|mjs)/.test(line) && !isComment(line))
        .map((line) => ({ file: relative(ROOT, path).split(sep).join('/'), line })),
    );

  it('finds both known readers', () => {
    if (!hasApps) return; // an engine-only product has no apps/ yet
    for (const [file, line] of Object.entries(KNOWN_READS)) {
      expect(mentions, file).toContainEqual({ file, line });
    }
  });

  it('allows no other mention of project.json or project.mjs', () => {
    const unknown = mentions.filter(({ file, line }) => KNOWN_READS[file] !== line);
    expect(unknown).toEqual([]);
  });
});
