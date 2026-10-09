// This repository used to be the family tree application, and before that
// nothing stopped its own name leaking into places a template has to be
// neutral about. Both leave a trail: a hardcoded "boris" or "family-tree"
// in a file that should have named nothing, or should have read
// project.json instead. This test is that trail's detector, run as `git
// grep` sees the repository rather than as a list anyone has to remember to
// update by hand.
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../project.mjs';

interface Allowed {
  file: string;
  pattern: RegExp;
  because: string;
}

/**
 * Every line this repository is allowed to still say "boris" or
 * "family-tree" on, and why. Matched by file and the line's own content,
 * never by line number — a reflow elsewhere in the file must not widen what
 * an entry hides. Keep this to exactly the lines that need it: a glob or a
 * whole-file entry here is the same shape of inert control this test exists
 * to catch everywhere else.
 */
const ALLOW: Allowed[] = [
  // The adoption ladder preserves the source document's own wording,
  // including its byline — CLAUDE.md says so.
  { file: 'docs/adoption.md', pattern: /Boris Cherny/, because: "the source document's own byline" },

  // Shared, byte-identical across every repository built from this one.
  // Another agent owns .claude/skills/sync-ai-layer/; it documents the
  // convention that naming boris as the master copy is the same everywhere.
  {
    file: '.claude/skills/sync-ai-layer/SKILL.md',
    pattern: /boris/i,
    because: 'owned by sync-ai-layer; documents naming boris as the master, which is the same everywhere',
  },

  // This repository's own name, and its relationship to repositories built
  // from it — "naming boris as the master is fine" is sync-ai-layer's own
  // rule, applied here in CLAUDE.md and README.md.
  { file: 'CLAUDE.md', pattern: /^# boris$/, because: "this repository's own name" },
  { file: 'CLAUDE.md', pattern: /Boris Cherny/, because: "the adoption ladder's author, named in this file's intro" },
  { file: 'CLAUDE.md', pattern: /boris is also the master copy/, because: 'this repository is the master copy; stated once' },
  { file: 'CLAUDE.md', pattern: /from boris\. Edit them in boris and sync/, because: 'syncing from this repository, named as itself' },
  { file: 'CLAUDE.md', pattern: /with boris or a repository built from it/, because: 'the sync-ai-layer skill row, naming this repository' },
  { file: 'CLAUDE.md', pattern: /gh api repos\/stevemarvell\/boris/, because: 'the actual GitHub path this repository is checked against' },
  {
    file: 'CLAUDE.md',
    pattern: /arborist crashes/,
    because: '"arborist" contains "boris" as a substring; this quotes npm\'s own error text verbatim',
  },
  { file: 'README.md', pattern: /^# boris$/, because: "this repository's own name" },
  { file: 'README.md', pattern: /Boris Cherny/, because: "the adoption ladder's author" },
  {
    file: 'docs/data-governance.md',
    pattern: /stevemarvell\.github\.io\/boris/,
    because: 'the actual GitHub Pages URL for this repository',
  },

  // The frozen step-0 artifact. CLAUDE.md and apps/web/scripts/build-docs.mjs
  // both say it is published exactly as it was written, never restyled.
  { file: 'index.html', pattern: /<title>boris<\/title>/, because: 'the frozen step-0 artifact; never restyled' },

  // This repository's own package and project name — project.json's `name`
  // is "boris", so npm's lockfile and manifest legitimately say so too.
  { file: 'package.json', pattern: /"name": "boris"/, because: "this repository's own package name" },
  { file: 'package-lock.json', pattern: /"name": "boris"/, because: "this repository's own package name" },
  { file: 'project.json', pattern: /"name": "boris"/, because: "this repository's own name, which project.json declares" },

  // telemetry/ is shared AI-layer infra naming, unrelated to the application
  // this issue purges family-tree from, and not in its scope.
  { file: 'telemetry/docker-compose.yml', pattern: /name: boris-telemetry/, because: 'local compose project namespace, out of this issue\'s scope' },
  { file: 'telemetry/grafana/dashboards/claude-code.json', pattern: /boris/, because: 'Grafana dashboard/datasource naming, out of this issue\'s scope' },
  { file: 'telemetry/grafana/provisioning/dashboards/dashboards.yml', pattern: /name: boris/, because: 'Grafana provisioning naming, out of this issue\'s scope' },
  { file: 'telemetry/grafana/provisioning/datasources/prometheus.yml', pattern: /uid: boris-prometheus/, because: 'Grafana datasource naming, out of this issue\'s scope' },

  // #210 rewrites the deployment wiring. Its family-tree-named Vercel
  // projects and URLs are left exactly as this issue's brief says to.
  { file: 'project.json', pattern: /"vercelProject": "family-tree-(api|web)"/, because: 'removed by #210' },
  { file: 'project.json', pattern: /"url": "https:\/\/family-tree-(api|web)[^"]*"/, because: 'removed by #210' },
  { file: 'apps/CLAUDE.md', pattern: /family-tree-(api|web)/, because: 'removed by #210' },
  { file: 'apps/.claude/skills/deployment/SKILL.md', pattern: /family-tree-api/, because: 'removed by #210' },
  { file: 'docs/data-governance.md', pattern: /family-tree-(api|web)/, because: 'removed by #210' },
];

/** `git grep -i -n -e boris -e family-tree` at the repository root, parsed into `{file, line, content}`. */
function grepHits() {
  const result = spawnSync('git', ['grep', '-i', '-n', '-e', 'boris', '-e', 'family-tree', '--', '.'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  // Exit code 1 means no matches, which is a valid (if surprising) outcome
  // here, not a failure of the command itself.
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git grep failed: ${result.stderr}`);
  }
  return result.stdout
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const match = /^([^:]+):(\d+):(.*)$/.exec(line);
      if (!match) throw new Error(`unparsed git grep line: ${line}`);
      const [, file, lineNo, content] = match;
      return { file: file as string, line: Number(lineNo), content: content as string };
    });
}

describe('no leftover "boris" or "family-tree" outside the allowlist', () => {
  const hits = grepHits();

  it('finds at least one hit, so an empty result is not read as a pass', () => {
    // A `git grep` that silently matched nothing — a bad pattern, a missing
    // cwd — would otherwise make this whole test vacuously green.
    expect(hits.length).toBeGreaterThan(0);
  });

  it('allows nothing beyond the explicit allowlist', () => {
    const unexplained = hits.filter(
      (hit) => !ALLOW.some((allowed) => allowed.file === hit.file && allowed.pattern.test(hit.content)),
    );
    expect(unexplained).toEqual([]);
  });

  it('keeps the allowlist itself honest: every entry matches a real hit', () => {
    // An entry whose pattern stopped matching anything is hiding nothing —
    // it is dead weight that would mask a genuinely new violation landing on
    // the same file.
    const stale = ALLOW.filter(
      (allowed) => !hits.some((hit) => hit.file === allowed.file && allowed.pattern.test(hit.content)),
    );
    expect(stale).toEqual([]);
  });
});
