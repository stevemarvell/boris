import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

// Lines that may still say "private repository": the history of when it was.
const HISTORY_ALLOWED: string[] = [];

describe('visibility statements', () => {
  it('no doc calls the repository a private repository, history aside', () => {
    const files = [
      'README.md',
      'CLAUDE.md',
      ...readdirSync(new URL('../../docs', import.meta.url))
        .filter((f) => f.endsWith('.md'))
        .map((f) => `docs/${f}`),
    ];
    const hits = files.flatMap((file) =>
      read(file)
        .split('\n')
        .map((line, i) => ({ at: `${file}:${i + 1}`, line }))
        .filter(({ line }) => /\bprivate (repository|repo)\b/i.test(line))
        .filter(({ line }) => !HISTORY_ALLOWED.some((ok) => line.includes(ok))),
    );
    expect(hits).toEqual([]);
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
