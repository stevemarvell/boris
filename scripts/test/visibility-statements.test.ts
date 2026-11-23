import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

// No allowlist: the one history sentence in data-governance ("It was private
// from 2026-09-14") never says "private repository", so nothing needs one.
const PRIVATE_REPO = /\bprivate (repository|repo)\b/i;

/** Every file whose prose could state the repository's visibility. */
const FILES = [
  'README.md',
  'CLAUDE.md',
  'apps/web/scripts/build-docs.mjs',
  'apps/web/.claude/skills/docs-site/SKILL.md',
  ...readdirSync(new URL('../../docs', import.meta.url))
    .filter((f) => f.endsWith('.md'))
    .map((f) => `docs/${f}`),
];

const privateClaims = (file: string, text: string) =>
  text
    .split('\n')
    .map((line, i) => ({ at: `${file}:${i + 1}`, line }))
    .filter(({ line }) => PRIVATE_REPO.test(line));

describe('visibility statements', () => {
  it('no doc calls the repository a private repository', () => {
    expect(FILES.flatMap((file) => privateClaims(file, read(file)))).toEqual([]);
  });

  it('scans the docs site builder and its skill, and they exist', () => {
    expect(FILES).toContain('apps/web/scripts/build-docs.mjs');
    expect(FILES).toContain('apps/web/.claude/skills/docs-site/SKILL.md');
    for (const file of FILES) expect(read(file).length).toBeGreaterThan(0);
  });

  it('flags a private-repository claim in the builder or the skill', () => {
    for (const file of ['apps/web/scripts/build-docs.mjs', 'apps/web/.claude/skills/docs-site/SKILL.md']) {
      const hits = privateClaims(file, `${read(file)}\nThis is a private repository.\n`);
      expect(hits.map((h) => h.at)).toEqual([expect.stringContaining(file)]);
    }
  });

  it('data-governance names the test that holds the no-print control', () => {
    const doc = read('docs/data-governance.md');
    expect(doc).toContain('scripts/test/no-secret-print.test.ts');
    const test = read('scripts/test/no-secret-print.test.ts');
    expect(test).toContain('GRAFANA_CLOUD_OTLP_AUTH');
    expect(test).toContain('WORKFLOWS_DIR');
    expect(test).toContain('workflowPrints(');
    expect(test).toContain('scriptPrints(');
  });

  it('data-governance does not call the repository private', () => {
    expect(read('docs/data-governance.md')).not.toContain('The repository is private');
  });

  it('CLAUDE.md does not call the repository private', () => {
    expect(read('CLAUDE.md')).not.toContain('The repository is private');
  });

  it('data-governance names the public date and the guard', () => {
    const doc = read('docs/data-governance.md');
    expect(doc).toContain('public as of 2026-11-15');
    expect(doc).toContain('author_association');
    expect(doc).toContain('CLAUDE_CODE_OAUTH_TOKEN');
  });

  it('CLAUDE.md says public since 2026-11-15 and points at #340', () => {
    const doc = read('CLAUDE.md');
    expect(doc).toContain("**Public, on GitHub's free plan since 2026-11-15.**");
    expect(doc).toContain('#340');
  });
});
