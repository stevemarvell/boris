// Nothing a template has to stay neutral about should be hardcoded anywhere
// in it: not this repository's own name, not an application it once ran, not
// a platform it once deployed to. Each leaves a trail wherever it leaks into
// a file that should have named nothing, or should have read project.json
// instead. This test is that trail's detector, run as `git grep` sees the
// repository rather than as a list anyone has to remember to update by hand.
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../project.mjs';

interface Allowed {
  file: string;
  pattern: RegExp;
  because: string;
}

/**
 * Every line this repository is allowed to still say one of NAMES on, and
 * why. Matched by file and the line's own content, never by line number — a
 * reflow elsewhere in the file must not widen what an entry hides. Keep this
 * to exactly the lines that need it: a glob or a whole-file entry here is
 * the same shape of inert control this test exists to catch everywhere else.
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
    file: 'scripts/labels.mjs',
    pattern: /Every repository built from boris/,
    because: 'naming boris as the master, the same convention sync-ai-layer documents',
  },
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
  // and out of scope for identity work that isn't about telemetry itself.
  { file: 'telemetry/docker-compose.yml', pattern: /name: boris-telemetry/, because: 'local compose project namespace, out of this issue\'s scope' },
  { file: 'telemetry/grafana/dashboards/claude-code.json', pattern: /boris/, because: 'Grafana dashboard/datasource naming, out of this issue\'s scope' },
  { file: 'telemetry/grafana/provisioning/dashboards/dashboards.yml', pattern: /name: boris/, because: 'Grafana provisioning naming, out of this issue\'s scope' },
  { file: 'telemetry/grafana/provisioning/datasources/prometheus.yml', pattern: /uid: boris-prometheus/, because: 'Grafana datasource naming, out of this issue\'s scope' },

  // #201 (human-owned) is the only place this repository still names that
  // platform — a dead Bash permission entry in .claude/settings.json, not
  // code, and not this issue's to touch.
  { file: '.claude/settings.json', pattern: /Bash\(railway up\*\)/, because: 'removed by #201' },

  // The setup instructions clone this repository by its real path, so
  // README.md's Quick start names it literally.
  { file: 'README.md', pattern: /gh repo clone stevemarvell\/boris/, because: 'the setup instructions clone this repository by its real path' },

  // `create`'s clone keeps "boris" as the remote name for this base, so a
  // clone can still fetch upstream without ever pushing to it by accident —
  // the literal remote name the script sets up, not this repository naming
  // itself.
  { file: 'scripts/setup.mjs', pattern: /BASE_REMOTE = 'boris'/, because: "the literal remote name create's clone sets up, not this repository naming itself" },

  // The real clone source: `create` clones this base by its actual path.
  { file: 'scripts/setup.mjs', pattern: /git@github\.com:stevemarvell\/boris\.git/, because: 'the actual GitHub path create clones from' },

  // The commit message CLAUDE.md's own #211 spells out verbatim: "Start <n>
  // from boris@<short-sha>".
  { file: 'scripts/setup.mjs', pattern: /from boris@/, because: 'the commit message create makes, naming the base it started from' },

  // The identity census hunts for the base's own name in whatever repository
  // `check` runs in — shared behaviour, the same everywhere, like
  // identity.test.ts's own NAMES list.
  { file: 'scripts/setup.mjs', pattern: /'-e', 'boris'/, because: "the identity census's own search term; shared and the same in every repository built from this one" },
];

// Every name this repository has to stay neutral about, and that has leaked
// in before: its own, an application it once ran, and a platform it once
// deployed to.
const NAMES = ['boris', 'family-tree', 'family tree', 'family_tree', 'genealog', 'railway'];

/**
 * `git grep -i -n` for every name in NAMES, at the repository root, parsed
 * into `{file, line, content}`. Excludes this file itself: a detector that
 * has to spell every name out, in patterns and in comments explaining them,
 * cannot also be a hit against its own rule. Also excludes
 * scripts/test/setup.test.ts, which tests the rename functions against
 * literal old-name fixtures by design — proving a rename works needs a
 * "boris" to rename, the same way this file needs one to detect.
 */
function grepHits() {
  const result = spawnSync(
    'git',
    [
      'grep',
      '-i',
      '-n',
      ...NAMES.flatMap((name) => ['-e', name]),
      '--',
      '.',
      ':(exclude)scripts/test/identity.test.ts',
      ':(exclude)scripts/test/setup.test.ts',
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
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

describe('no leftover name from NAMES outside the allowlist', () => {
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
