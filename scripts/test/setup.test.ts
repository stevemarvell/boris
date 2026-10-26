import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MARK,
  OWNER_ISSUES,
  TELEMETRY_FILES,
  branchProtectionDecision,
  create,
  ensureEmptyTarget,
  missingOwnerIssues,
  missingPreflight,
  needsTemplateIssue,
  parseCheckArgs,
  parseCreateArgs,
  placeholderClaudeMd,
  preflight,
  renameIdentity,
  renameJsonName,
  renamePyproject,
  renameTelemetry,
  renderCheck,
  rewriteIdentityTestForClone,
  runCheck,
  type Run,
  type Spawn,
} from '../setup.mjs';
import { ROOT } from '../project.mjs';

describe('parseCreateArgs', () => {
  it('parses --name, --owner, --dir and --public', () => {
    expect(parseCreateArgs(['--name', 'n', '--owner', 'o', '--dir', '../n', '--public'])).toEqual({
      name: 'n',
      owner: 'o',
      dir: '../n',
      public: true,
    });
  });

  it('defaults --dir to ../<name> and --public to false', () => {
    expect(parseCreateArgs(['--name', 'n', '--owner', 'o'])).toEqual({ name: 'n', owner: 'o', dir: '../n', public: false });
  });

  it('requires --name', () => {
    expect(() => parseCreateArgs(['--owner', 'o'])).toThrow(/--name/);
  });

  it('requires --owner', () => {
    expect(() => parseCreateArgs(['--name', 'n'])).toThrow(/--owner/);
  });

  it('refuses an unknown flag', () => {
    expect(() => parseCreateArgs(['--name', 'n', '--owner', 'o', '--nope'])).toThrow(/unknown flag/);
  });

  it('refuses a flag with no value', () => {
    expect(() => parseCreateArgs(['--name'])).toThrow(/needs a value/);
  });

  it('refuses a flag whose value looks like another flag', () => {
    expect(() => parseCreateArgs(['--name', '--owner', 'o'])).toThrow(/needs a value/);
  });
});

describe('parseCheckArgs', () => {
  it('defaults everything to off', () => {
    expect(parseCheckArgs([])).toEqual({ skipVerify: false, dryRun: false });
  });

  it('parses --skip-verify, --dry-run and --repo', () => {
    expect(parseCheckArgs(['--skip-verify', '--dry-run', '--repo', 'o/n'])).toEqual({
      skipVerify: true,
      dryRun: true,
      repo: 'o/n',
    });
  });

  it('refuses an unknown flag', () => {
    expect(() => parseCheckArgs(['--nope'])).toThrow(/unknown flag/);
  });

  it('refuses --repo with no value', () => {
    expect(() => parseCheckArgs(['--repo'])).toThrow(/needs a value/);
  });
});

describe('preflight', () => {
  it('reports every check ok when every command succeeds and Node is new enough', async () => {
    const run: Run = async () => ({ status: 0, stdout: 'x', stderr: '' });
    const results = await preflight({ run, nodeVersion: 'v22.1.0' });
    expect(missingPreflight(results)).toEqual([]);
    expect(results.map((r) => r.name)).toEqual(['gh api user', 'git', 'node >= 22', 'uv', 'npx npm@11']);
  });

  it('names what failed when a command fails, with its stderr', async () => {
    const run: Run = async (cmd) => (cmd === 'uv' ? { status: 1, stdout: '', stderr: 'not found' } : { status: 0, stdout: 'x', stderr: '' });
    const results = await preflight({ run, nodeVersion: 'v22.1.0' });
    const missing = missingPreflight(results);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ name: 'uv', detail: 'not found' });
  });

  it('fails the node check under Node 22, regardless of what the commands report', async () => {
    const run: Run = async () => ({ status: 0, stdout: 'x', stderr: '' });
    const results = await preflight({ run, nodeVersion: 'v20.11.0' });
    const missing = missingPreflight(results);
    expect(missing.map((r) => r.name)).toEqual(['node >= 22']);
  });

  it('passes the node check at exactly 22', async () => {
    const run: Run = async () => ({ status: 0, stdout: 'x', stderr: '' });
    const results = await preflight({ run, nodeVersion: 'v22.0.0' });
    expect(missingPreflight(results)).toEqual([]);
  });
});

describe('renameJsonName', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'setup-rename-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('renames the name field when it matches', () => {
    const path = join(root, 'project.json');
    writeFileSync(path, JSON.stringify({ name: 'boris', apps: {} }));
    expect(renameJsonName(path, 'boris', 'acme')).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf8')).name).toBe('acme');
  });

  it('leaves the file untouched and reports false when the name does not match', () => {
    const path = join(root, 'project.json');
    const original = JSON.stringify({ name: 'something-else', apps: {} });
    writeFileSync(path, original);
    expect(renameJsonName(path, 'boris', 'acme')).toBe(false);
    expect(readFileSync(path, 'utf8')).toBe(original);
  });
});

describe('renamePyproject', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'setup-pyproject-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('renames the [project] name when it matches', () => {
    const path = join(root, 'pyproject.toml');
    writeFileSync(path, '[project]\nname = "boris"\nversion = "0.1.0"\n');
    expect(renamePyproject(path, 'boris', 'acme')).toBe(true);
    expect(readFileSync(path, 'utf8')).toContain('name = "acme"');
  });

  it('does nothing when the app already has its own name, like the real api app', () => {
    const path = join(root, 'pyproject.toml');
    writeFileSync(path, '[project]\nname = "api"\nversion = "0.1.0"\n');
    expect(renamePyproject(path, 'boris', 'acme')).toBe(false);
    expect(readFileSync(path, 'utf8')).toContain('name = "api"');
  });
});

describe('renameTelemetry', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'setup-telemetry-'));
    for (const rel of TELEMETRY_FILES) {
      mkdirSync(join(root, rel, '..'), { recursive: true });
    }
    writeFileSync(join(root, TELEMETRY_FILES[0]!), 'name: boris-telemetry\n');
    writeFileSync(join(root, TELEMETRY_FILES[1]!), 'uid: boris-prometheus\n');
    writeFileSync(join(root, TELEMETRY_FILES[2]!), 'providers:\n  - name: boris\n');
    writeFileSync(join(root, TELEMETRY_FILES[3]!), '{"uid": "boris-claude-code", "tags": ["claude-code", "boris"]}\n');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('renames every whole-word occurrence in every telemetry file, and reports which changed', () => {
    const changed = renameTelemetry(root, 'boris', 'acme');
    expect(changed.sort()).toEqual([...TELEMETRY_FILES].sort());
    expect(readFileSync(join(root, TELEMETRY_FILES[0]!), 'utf8')).toBe('name: acme-telemetry\n');
    expect(readFileSync(join(root, TELEMETRY_FILES[1]!), 'utf8')).toBe('uid: acme-prometheus\n');
    expect(readFileSync(join(root, TELEMETRY_FILES[2]!), 'utf8')).toBe('providers:\n  - name: acme\n');
    expect(readFileSync(join(root, TELEMETRY_FILES[3]!), 'utf8')).toBe('{"uid": "acme-claude-code", "tags": ["claude-code", "acme"]}\n');
  });

  it('never touches an unrelated word that merely contains the old name as a substring', () => {
    writeFileSync(join(root, TELEMETRY_FILES[0]!), 'name: boris-telemetry   # arborist\n');
    const changed = renameTelemetry(root, 'boris', 'acme');
    expect(changed).toContain(TELEMETRY_FILES[0]);
    expect(readFileSync(join(root, TELEMETRY_FILES[0]!), 'utf8')).toContain('arborist');
  });

  it('reports no files changed, and touches nothing, when the name does not match', () => {
    expect(renameTelemetry(root, 'nope', 'acme')).toEqual([]);
  });

  it('skips a telemetry file that does not exist, rather than throwing', () => {
    rmSync(join(root, TELEMETRY_FILES[0]!));
    expect(() => renameTelemetry(root, 'boris', 'acme')).not.toThrow();
  });
});

describe('placeholderClaudeMd', () => {
  const sample = [
    '# boris',
    '',
    'intro text',
    '',
    '## Repository settings',
    '',
    'Checked with `gh api repos/stevemarvell/boris`, not assumed:',
    '',
    "- **Private.** Some boris-specific fact.",
    '- Another boris-specific fact.',
    '',
    '## Deployments and documentation',
    '',
    'VERCEL_TOKEN expires 2026-03-01.',
  ].join('\n');

  it('replaces the Repository settings section with a placeholder naming the real owner/repo', () => {
    const out = placeholderClaudeMd(sample, { owner: 'acme-owner', name: 'acme' });
    expect(out).toContain('gh api repos/acme-owner/acme');
    expect(out).not.toContain('stevemarvell/boris');
    expect(out).not.toContain('boris-specific fact');
  });

  it('leaves everything outside the Repository settings section alone', () => {
    const out = placeholderClaudeMd(sample, { owner: 'acme-owner', name: 'acme' });
    expect(out).toContain('# boris');
    expect(out).toContain('## Deployments and documentation');
  });

  it('blanks a real VERCEL_TOKEN expiry date, which was never this clone\'s own', () => {
    const out = placeholderClaudeMd(sample, { owner: 'acme-owner', name: 'acme' });
    expect(out).toContain('VERCEL_TOKEN expires <expiry>');
    expect(out).not.toContain('2026-03-01');
  });

  it('throws rather than silently doing nothing when there is no Repository settings heading', () => {
    expect(() => placeholderClaudeMd('# boris\n\nno such section\n', { owner: 'o', name: 'n' })).toThrow(/Repository settings/);
  });
});

describe('rewriteIdentityTestForClone', () => {
  const real = readFileSync(join(ROOT, 'scripts/test/identity.test.ts'), 'utf8');

  it('rewrites every ALLOW entry a rename invalidates, against the real file', () => {
    const out = rewriteIdentityTestForClone(real, { oldName: 'boris', newName: 'acme', owner: 'acme-owner' });
    expect(out).toContain('gh api repos\\/acme-owner\\/acme');
    expect(out).toContain(`{ file: 'package.json', pattern: /"name": "acme"/`);
    expect(out).toContain(`{ file: 'package-lock.json', pattern: /"name": "acme"/`);
    expect(out).toContain(`{ file: 'project.json', pattern: /"name": "acme"/`);
    expect(out).toContain('pattern: /name: acme-telemetry/');
    expect(out).toContain("pattern: /acme/, because: 'Grafana dashboard/datasource naming");
    expect(out).toContain("pattern: /name: acme/, because: 'Grafana provisioning naming");
    expect(out).toContain('pattern: /uid: acme-prometheus/');
  });

  it('leaves every entry a rename does not invalidate untouched, including the ones this file just added for itself', () => {
    const out = rewriteIdentityTestForClone(real, { oldName: 'boris', newName: 'acme', owner: 'acme-owner' });
    expect(out).toContain("pattern: /^# boris$/");
    expect(out).toContain('Boris Cherny');
    expect(out).toContain("BASE_REMOTE = 'boris'");
    expect(out).toContain('gh repo clone stevemarvell\\/boris');
  });

  it('throws, rather than silently doing nothing, when expected source text is missing', () => {
    expect(() => rewriteIdentityTestForClone('nothing to rewrite here', { oldName: 'boris', newName: 'acme', owner: 'o' })).toThrow(
      /expected to find/,
    );
  });
});

describe('renameIdentity', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'setup-identity-'));
    mkdirSync(join(root, 'apps/api'), { recursive: true });
    mkdirSync(join(root, 'scripts/test'), { recursive: true });
    for (const rel of TELEMETRY_FILES) mkdirSync(join(root, rel, '..'), { recursive: true });

    writeFileSync(join(root, 'project.json'), JSON.stringify({ name: 'boris', apps: { api: { path: 'apps/api', toolchain: 'python', reads: ['apps/api'] } } }));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'boris', private: true }));
    writeFileSync(join(root, 'apps/api/pyproject.toml'), '[project]\nname = "api"\nversion = "0.1.0"\n');
    writeFileSync(join(root, TELEMETRY_FILES[0]!), 'name: boris-telemetry\n');
    writeFileSync(join(root, TELEMETRY_FILES[1]!), 'uid: boris-prometheus\n');
    writeFileSync(join(root, TELEMETRY_FILES[2]!), '  - name: boris\n');
    writeFileSync(join(root, TELEMETRY_FILES[3]!), '{"uid": "boris-claude-code", "tags": ["claude-code", "boris"]}\n');
    writeFileSync(
      join(root, 'CLAUDE.md'),
      ['# boris', '', '## Repository settings', '', 'Checked with `gh api repos/stevemarvell/boris`, not assumed:', '', '- a fact', ''].join('\n'),
    );
    writeFileSync(join(root, 'scripts/test/identity.test.ts'), readFileSync(join(ROOT, 'scripts/test/identity.test.ts'), 'utf8'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('renames every identity file it is given, and reports what changed', () => {
    const project = JSON.parse(readFileSync(join(root, 'project.json'), 'utf8'));
    const changed = renameIdentity({ root, oldName: 'boris', newName: 'acme', owner: 'acme-owner', project });

    expect(JSON.parse(readFileSync(join(root, 'project.json'), 'utf8')).name).toBe('acme');
    expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name).toBe('acme');
    expect(readFileSync(join(root, 'apps/api/pyproject.toml'), 'utf8')).toContain('name = "api"'); // unchanged: already its own name
    expect(readFileSync(join(root, TELEMETRY_FILES[0]!), 'utf8')).toBe('name: acme-telemetry\n');
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toContain('gh api repos/acme-owner/acme');
    expect(readFileSync(join(root, 'scripts/test/identity.test.ts'), 'utf8')).toContain(
      `{ file: 'project.json', pattern: /"name": "acme"/`,
    );
    expect(changed).toContain('project.json');
    expect(changed).toContain('package.json');
    expect(changed).toContain('CLAUDE.md');
    expect(changed).toContain('scripts/test/identity.test.ts');
  });
});

describe('renderCheck', () => {
  it('exits 0 when every line is ✔ or ✚', () => {
    const { lines, exitCode } = renderCheck([
      { mark: MARK.done, text: 'a' },
      { mark: MARK.fixed, text: 'b' },
    ]);
    expect(lines).toEqual(['✔ a', '✚ b']);
    expect(exitCode).toBe(0);
  });

  it('exits 1 when any line is ✋, regardless of position', () => {
    expect(renderCheck([{ mark: MARK.done, text: 'a' }, { mark: MARK.owner, text: 'b' }]).exitCode).toBe(1);
    expect(renderCheck([{ mark: MARK.owner, text: 'a' }, { mark: MARK.done, text: 'b' }]).exitCode).toBe(1);
  });

  it('exits 0 on an empty list', () => {
    expect(renderCheck([]).exitCode).toBe(0);
  });
});

describe('branchProtectionDecision', () => {
  it('fixes it for a public repository', () => {
    const d = branchProtectionDecision({ isPrivate: false });
    expect(d.mark).toBe(MARK.fixed);
    expect(d.text).toMatch(/develop/);
  });

  it('calls it discipline for a private, free-plan repository', () => {
    const d = branchProtectionDecision({ isPrivate: true });
    expect(d.mark).toBe(MARK.done);
    expect(d.text).toMatch(/discipline/);
  });
});

describe('missingOwnerIssues', () => {
  it('returns every owner issue when none exist yet', () => {
    expect(missingOwnerIssues([])).toEqual(OWNER_ISSUES);
  });

  it('excludes an issue that already exists, by exact title', () => {
    const existing = [OWNER_ISSUES[0]!.title];
    const missing = missingOwnerIssues(existing);
    expect(missing).toHaveLength(OWNER_ISSUES.length - 1);
    expect(missing.some((i) => i.title === OWNER_ISSUES[0]!.title)).toBe(false);
  });

  it('is not fooled by a closed issue counting as existing: callers pass --state all', () => {
    // missingOwnerIssues itself only ever sees titles; this documents why
    // runCheck fetches issue titles with --state all rather than the
    // open-only default, so a person who already closed one of these by
    // hand never gets it recreated.
    expect(missingOwnerIssues([OWNER_ISSUES[1]!.title])).not.toContainEqual(OWNER_ISSUES[1]);
  });

  it('returns nothing once every owner issue already exists, so a re-run creates nothing new', () => {
    expect(missingOwnerIssues(OWNER_ISSUES.map((i) => i.title))).toEqual([]);
  });
});

describe('needsTemplateIssue', () => {
  it('is true when no open issue carries the template label', () => {
    expect(needsTemplateIssue([{ labels: ['bug'] }])).toBe(true);
    expect(needsTemplateIssue([])).toBe(true);
  });

  it('is false once one does, so a re-run never files a second one', () => {
    expect(needsTemplateIssue([{ labels: ['bug'] }, { labels: ['template'] }])).toBe(false);
  });
});

describe('runCheck', () => {
  function run(responses: Record<string, RunResultLike>): Run {
    return async (cmd, args) => {
      const key = `${cmd} ${args.join(' ')}`;
      for (const [prefix, result] of Object.entries(responses)) {
        if (key.startsWith(prefix)) return result;
      }
      throw new Error(`unexpected call: ${key}`);
    };
  }

  type RunResultLike = { status: number; stdout: string; stderr: string };

  // runCheck's own real default for this spawns `npx vitest run
  // scripts/test/identity.test.ts`, which is exactly right in production and
  // exactly wrong recursed into from inside this test run — every test below
  // stubs it unless it is itself testing this path.
  const identityOk = () => ({ ok: true, output: '' });

  const restIssue = (title: string, labels: string[] = []) => ({ title, labels: labels.map((name) => ({ name })) });
  const repoJson = (over: Record<string, unknown> = {}) =>
    JSON.stringify({ private: true, delete_branch_on_merge: true, html_url: 'https://x', ...over });

  // Prefix-matched in insertion order, so the specific routes come before the
  // bare repository route they all begin with.
  const baseResponses: Record<string, RunResultLike> = {
    'gh api repos/{owner}/{repo}/labels': { status: 0, stdout: JSON.stringify([]), stderr: '' },
    'gh api repos/{owner}/{repo}/issues?state=all': {
      status: 0,
      stdout: JSON.stringify(OWNER_ISSUES.map((i) => restIssue(i.title))),
      stderr: '',
    },
    'gh api repos/{owner}/{repo}/issues?state=open': {
      status: 0,
      stdout: JSON.stringify([restIssue('Template: User story', ['template'])]),
      stderr: '',
    },
    'gh api user': { status: 0, stdout: 'octocat\n', stderr: '' },
    'gh secret list': { status: 0, stdout: JSON.stringify([{ name: 'CLAUDE_CODE_OAUTH_TOKEN' }]), stderr: '' },
    'gh api repos/{owner}/{repo}': { status: 0, stdout: repoJson(), stderr: '' },
  };

  it('exits 0 when every check is already satisfied', async () => {
    const result = await runCheck({ run: run(baseResponses), skipVerify: true, runIdentityTest: identityOk });
    expect(result.exitCode).toBe(0);
    expect(result.lines.some((l) => l.startsWith(MARK.owner))).toBe(false);
  });

  it('reports an owner action, and exits 1, when CLAUDE_CODE_OAUTH_TOKEN is missing', async () => {
    const result = await runCheck({
      run: run({ ...baseResponses, 'gh secret list': { status: 0, stdout: '[]', stderr: '' } }),
      skipVerify: true,
      runIdentityTest: identityOk,
    });
    expect(result.exitCode).toBe(1);
    expect(result.lines.some((l) => l.includes('CLAUDE_CODE_OAUTH_TOKEN') && l.startsWith(MARK.owner))).toBe(true);
  });

  it('under --dry-run, reports what it would do as an owner action rather than doing it', async () => {
    const calls: string[] = [];
    const dryRun = run({
      ...baseResponses,
      'gh api repos/{owner}/{repo}': { status: 0, stdout: repoJson({ delete_branch_on_merge: false }), stderr: '' },
    });
    const result = await runCheck({
      run: async (cmd, args) => {
        calls.push(`${cmd} ${args.join(' ')}`);
        return dryRun(cmd, args);
      },
      dryRun: true,
      skipVerify: true,
      runIdentityTest: identityOk,
    });
    expect(result.exitCode).toBe(1);
    expect(result.lines.some((l) => l.includes('delete_branch_on_merge') && l.startsWith(MARK.owner))).toBe(true);
    expect(calls.some((c) => c.includes('delete_branch_on_merge=true'))).toBe(false);
  });

  it('files a missing owner issue, labelled human and do not automate, and reports it fixed', async () => {
    const calls: string[][] = [];
    const result = await runCheck({
      run: async (cmd, args) => {
        calls.push([cmd, ...args]);
        if (cmd === 'gh' && args[0] === 'api' && args[1]!.includes('/issues?state=all')) {
          return { status: 0, stdout: JSON.stringify(OWNER_ISSUES.slice(1).map((i) => restIssue(i.title))), stderr: '' };
        }
        if (cmd === 'gh' && args.includes('POST') && args[1]!.endsWith('/issues')) return { status: 0, stdout: '', stderr: '' };
        return run(baseResponses)(cmd, args);
      },
      skipVerify: true,
      runIdentityTest: identityOk,
    });
    const createCall = calls.find((c) => c.includes('POST') && c.includes(`title=${OWNER_ISSUES[0]!.title}`));
    expect(createCall).toBeDefined();
    expect(createCall!.slice(0, 3)).toEqual(['gh', 'api', 'repos/{owner}/{repo}/issues']);
    expect(createCall).toContain('labels[]=human');
    expect(createCall).toContain('labels[]=do not automate');
    expect(createCall).toContain('assignees[]=octocat');
    // REST, never `gh issue create` (GraphQL, refused from cloud sessions).
    expect(calls.some((c) => c[1] === 'issue')).toBe(false);
    expect(result.lines.some((l) => l.includes(OWNER_ISSUES[0]!.title) && l.startsWith(MARK.fixed))).toBe(true);
  });

  it('refuses to file owner issues unassigned: a failed login lookup is a failure, not a quiet filing', async () => {
    const calls: string[][] = [];
    await expect(
      runCheck({
        run: async (cmd, args) => {
          calls.push([cmd, ...args]);
          if (cmd === 'gh' && args[0] === 'api' && args[1]!.includes('/issues?state=all')) {
            return { status: 0, stdout: JSON.stringify(OWNER_ISSUES.slice(1).map((i) => restIssue(i.title))), stderr: '' };
          }
          if (cmd === 'gh' && args[1] === 'user') return { status: 1, stdout: '', stderr: 'HTTP 403' };
          return run(baseResponses)(cmd, args);
        },
        skipVerify: true,
        runIdentityTest: identityOk,
      }),
    ).rejects.toThrow(/gh api user failed: HTTP 403/);
    expect(calls.some((c) => c.includes('POST') && c.some((a) => a.endsWith('/issues')))).toBe(false);
  });

  it('reports the identity census done when scripts/test/identity.test.ts passes', async () => {
    const result = await runCheck({ run: run(baseResponses), skipVerify: true, runIdentityTest: identityOk });
    expect(result.lines.some((l) => l.includes('identity census') && l.startsWith(MARK.done))).toBe(true);
  });

  it('reports the identity census as an owner action, with the trimmed failure output, when the real test fails', async () => {
    const result = await runCheck({
      run: run(baseResponses),
      skipVerify: true,
      runIdentityTest: () => ({ ok: false, output: 'FAIL scripts/test/identity.test.ts\napps/web/src/leftover.ts names the base' }),
    });
    expect(result.exitCode).toBe(1);
    const line = result.lines.find((l) => l.includes('identity census'));
    expect(line).toBeDefined();
    expect(line).toMatch(new RegExp(`^${MARK.owner}`));
    expect(line).toContain('apps/web/src/leftover.ts names the base');
  });

  it('runs the real identity test by default, not a re-derived allowlist', async () => {
    // No runIdentityTest override: this exercises the real default, which
    // spawns scripts/test/identity.test.ts itself via vitest — proving the
    // census is the actual test, not a second copy of what it allows.
    const result = await runCheck({ run: run(baseResponses), skipVerify: true });
    const line = result.lines.find((l) => l.includes('identity census'));
    expect(line).toBeDefined();
    expect(line).toMatch(new RegExp(`^${MARK.done}`));
  }, 30_000);

  it('skips npm run verify under --skip-verify, and reports it fixed/done rather than owner', async () => {
    const result = await runCheck({ run: run(baseResponses), skipVerify: true, runIdentityTest: identityOk });
    expect(result.lines.some((l) => l.includes('verify') && l.includes('skipped'))).toBe(true);
  });

  it('reports npm run verify as an owner action when it fails', async () => {
    const result = await runCheck({ run: run(baseResponses), skipVerify: false, runVerify: () => 1, runIdentityTest: identityOk });
    expect(result.exitCode).toBe(1);
    expect(result.lines.some((l) => l.includes('verify') && l.startsWith(MARK.owner))).toBe(true);
  });

  it('reports no deployed app to check when project.json deploys nothing, which is this repository today', async () => {
    const result = await runCheck({ run: run(baseResponses), skipVerify: true, runIdentityTest: identityOk });
    expect(result.lines.some((l) => l.includes('no app has a deploy block'))).toBe(true);
  });

  it('always prints the closing next-steps section', async () => {
    const result = await runCheck({ run: run(baseResponses), skipVerify: true, runIdentityTest: identityOk });
    expect(result.lines.some((l) => l.includes('work-backlog'))).toBe(true);
  });

  it("reads project.json and README.md from the given root, not this repository's own", async () => {
    // This is what create()'s own guard depends on: it must be possible to
    // point runCheck at a clone without it quietly grading this checkout
    // instead. A root with a deployed app and a real VERCEL_TOKEN expiry,
    // where this repository's own project.json and README have neither,
    // proves the read actually moved.
    const root = mkdtempSync(join(tmpdir(), 'setup-root-'));
    try {
      writeFileSync(
        join(root, 'project.json'),
        JSON.stringify({
          name: 'acme',
          apps: {
            web: {
              path: 'apps/web',
              toolchain: 'node',
              reads: ['apps/web'],
              deploy: { provider: 'vercel', team: 't', project: 'p', url: 'https://acme.example', commitEndpoint: '/health' },
            },
          },
        }),
      );
      writeFileSync(join(root, 'README.md'), '| VERCEL_TOKEN | expires 2027-01-01 |\n');

      const result = await runCheck({
        run: run({
          ...baseResponses,
          'gh secret list': {
            status: 0,
            stdout: JSON.stringify([{ name: 'CLAUDE_CODE_OAUTH_TOKEN' }, { name: 'VERCEL_TOKEN' }]),
            stderr: '',
          },
        }),
        root,
        skipVerify: true,
        runIdentityTest: identityOk,
        fetchUrl: async () => ({ status: 200, text: async () => 'hello' }) as unknown as Response,
      });

      expect(result.lines.some((l) => l.includes('web:') && l.includes('acme.example'))).toBe(true);
      expect(result.lines.some((l) => l.includes("VERCEL_TOKEN's expiry is recorded"))).toBe(true);
      expect(result.lines.some((l) => l.includes('no app has a deploy block'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('ensureEmptyTarget', () => {
  function run(responses: Record<string, { status: number; stdout: string; stderr: string }>): Run {
    return async (cmd, args) => {
      const key = `${cmd} ${args.join(' ')}`;
      for (const [prefix, result] of Object.entries(responses)) {
        if (key.startsWith(prefix)) return result;
      }
      throw new Error(`unexpected call: ${key}`);
    };
  }

  it('reports "does not exist" when the repository lookup fails, without checking emptiness', async () => {
    const calls: string[] = [];
    const result = await ensureEmptyTarget({
      run: async (cmd, args) => {
        calls.push(`${cmd} ${args.join(' ')}`);
        return { status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' };
      },
      target: 'o/n',
    });
    expect(result).toEqual({ exists: false });
    expect(calls).toHaveLength(1); // only the existence check; no branches call
  });

  it('treats only a 404 as "does not exist": a 403, a rate limit or a network error throws', async () => {
    for (const stderr of ['HTTP 403: Forbidden', 'API rate limit exceeded (HTTP 429)', 'dial tcp: connection refused']) {
      await expect(
        ensureEmptyTarget({ run: async () => ({ status: 1, stdout: '', stderr }), target: 'o/n' }),
      ).rejects.toThrow(/repos\/o\/n failed/);
    }
  });

  it('treats GitHub\'s 409 "Git Repository is empty." as empty', async () => {
    const result = await ensureEmptyTarget({
      run: run({
        'gh api repos/o/n --jq .name': { status: 0, stdout: 'n', stderr: '' },
        'gh api repos/o/n/branches': {
          status: 1,
          stdout: '{"message":"Git Repository is empty."}',
          stderr: 'gh: Git Repository is empty. (HTTP 409)',
        },
      }),
      target: 'o/n',
    });
    expect(result).toEqual({ exists: true });
  });

  it('keeps every other 409, and every other failure of the emptiness check, fail-closed', async () => {
    for (const stderr of ['gh: Conflict (HTTP 409)', 'gh: Git Repository is empty.', 'HTTP 403: Forbidden']) {
      await expect(
        ensureEmptyTarget({
          run: run({
            'gh api repos/o/n --jq .name': { status: 0, stdout: 'n', stderr: '' },
            'gh api repos/o/n/branches': { status: 1, stdout: '', stderr },
          }),
          target: 'o/n',
        }),
      ).rejects.toThrow(/branches failed/);
    }
  });

  it('proceeds when the repository exists and it has no branches', async () => {
    const result = await ensureEmptyTarget({
      run: run({
        'gh api repos/o/n --jq .name': { status: 0, stdout: '{}', stderr: '' },
        'gh api repos/o/n/branches': { status: 0, stdout: '[]', stderr: '' },
      }),
      target: 'o/n',
    });
    expect(result).toEqual({ exists: true });
  });

  it('refuses an existing, non-empty repository', async () => {
    await expect(
      ensureEmptyTarget({
        run: run({
          'gh api repos/o/n --jq .name': { status: 0, stdout: '{}', stderr: '' },
          'gh api repos/o/n/branches': { status: 0, stdout: '[{"name":"develop"}]', stderr: '' },
        }),
        target: 'o/n',
      }),
    ).rejects.toThrow(/already exists and is not empty/);
  });

  it('fails closed, with gh\'s own stderr, when the emptiness check itself errors — never falling through to "assume empty"', async () => {
    await expect(
      ensureEmptyTarget({
        run: run({
          'gh api repos/o/n --jq .name': { status: 0, stdout: '{}', stderr: '' },
          'gh api repos/o/n/branches': { status: 1, stdout: '', stderr: 'API rate limit exceeded' },
        }),
        target: 'o/n',
      }),
    ).rejects.toThrow(/API rate limit exceeded/);
  });

  it('fails closed when the emptiness check returns unparseable JSON', async () => {
    await expect(
      ensureEmptyTarget({
        run: run({
          'gh api repos/o/n --jq .name': { status: 0, stdout: '{}', stderr: '' },
          'gh api repos/o/n/branches': { status: 0, stdout: 'not json', stderr: '' },
        }),
        target: 'o/n',
      }),
    ).rejects.toThrow(/unparseable JSON/);
  });
});

describe('create', () => {
  function stubRun(overrides: Record<string, { status: number; stdout: string; stderr: string }>): { run: Run; calls: string[][] } {
    const calls: string[][] = [];
    const run: Run = async (cmd, args) => {
      calls.push([cmd, ...args]);
      const key = `${cmd} ${args.join(' ')}`;
      for (const [prefix, result] of Object.entries(overrides)) {
        if (key.startsWith(prefix)) return result;
      }
      // Preflight passes by default, so every test only has to override what it cares about.
      return { status: 0, stdout: 'ok', stderr: '' };
    };
    return { run, calls };
  }

  it('a hard failure checking emptiness stops create before any clone or push', async () => {
    const { run, calls } = stubRun({
      'gh api repos/o/n --jq .name': { status: 0, stdout: '{}', stderr: '' },
      'gh api repos/o/n/branches': { status: 1, stdout: '', stderr: 'API rate limit exceeded' },
    });
    await expect(create({ name: 'n', owner: 'o', dir: '/nonexistent', public: false }, { run })).rejects.toThrow(
      /API rate limit exceeded/,
    );
    expect(calls.some((c) => c[0] === 'git' && c[1] === 'clone')).toBe(false);
    expect(calls.some((c) => c[0] === 'git' && c[1] === 'push')).toBe(false);
  });

  it('refuses an existing, non-empty target before any clone or push', async () => {
    const { run, calls } = stubRun({
      'gh api repos/o/n --jq .name': { status: 0, stdout: '{}', stderr: '' },
      'gh api repos/o/n/branches': { status: 0, stdout: '[{"name":"develop"}]', stderr: '' },
    });
    await expect(create({ name: 'n', owner: 'o', dir: '/nonexistent', public: false }, { run })).rejects.toThrow(
      /already exists and is not empty/,
    );
    expect(calls.some((c) => c[0] === 'git' && c[1] === 'clone')).toBe(false);
  });

  it('an empty repository proceeds past the guard and attempts the clone', async () => {
    const { run, calls } = stubRun({
      'gh api repos/o/n --jq .name': { status: 0, stdout: '{}', stderr: '' },
      'gh api repos/o/n/branches': { status: 0, stdout: '[]', stderr: '' },
      // Deliberately fails the clone itself, so the test stops there rather
      // than reaching the real filesystem/bootstrap/verify/push pipeline.
      'git clone': { status: 1, stdout: '', stderr: 'stopped for the test' },
    });
    await expect(create({ name: 'n', owner: 'o', dir: '/nonexistent', public: false }, { run })).rejects.toThrow(
      /git clone failed/,
    );
    expect(calls.some((c) => c[0] === 'git' && c[1] === 'clone')).toBe(true);
  });

  it('a brand-new target (the repository lookup fails) creates the repository and proceeds to clone', async () => {
    const { run, calls } = stubRun({
      'gh api repos/o/n --jq .name': { status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' },
      'gh api orgs/o/repos': { status: 0, stdout: '', stderr: '' },
      'git clone': { status: 1, stdout: '', stderr: 'stopped for the test' },
    });
    await expect(create({ name: 'n', owner: 'o', dir: '/nonexistent', public: false }, { run })).rejects.toThrow(
      /git clone failed/,
    );
    const createCall = calls.find((c) => c.includes('orgs/o/repos'));
    expect(createCall).toEqual(['gh', 'api', 'orgs/o/repos', '-X', 'POST', '-f', 'name=n', '-F', 'private=true']);
    // REST, never `gh repo create` (GraphQL, refused from cloud sessions).
    expect(calls.some((c) => c[0] === 'gh' && c[1] === 'repo')).toBe(false);
    expect(calls.some((c) => c[0] === 'git' && c[1] === 'clone')).toBe(true);
  });

  it('creates the repository under the authenticated account when it is the owner, publicly if asked', async () => {
    const { run, calls } = stubRun({
      'gh api user': { status: 0, stdout: 'O\n', stderr: '' },
      'gh api repos/o/n --jq .name': { status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' },
      'gh api user/repos': { status: 0, stdout: '', stderr: '' },
      'git clone': { status: 1, stdout: '', stderr: 'stopped for the test' },
    });
    await expect(create({ name: 'n', owner: 'o', dir: '/nonexistent', public: true }, { run })).rejects.toThrow(/git clone failed/);
    expect(calls.find((c) => c.includes('user/repos'))).toEqual(['gh', 'api', 'user/repos', '-X', 'POST', '-f', 'name=n', '-F', 'private=false']);
  });

  it('stops before cloning when creating the repository fails', async () => {
    const { run, calls } = stubRun({
      'gh api repos/o/n --jq .name': { status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' },
      'gh api orgs/o/repos': { status: 1, stdout: '', stderr: 'HTTP 403' },
    });
    await expect(create({ name: 'n', owner: 'o', dir: '/nonexistent', public: false }, { run })).rejects.toThrow(/HTTP 403/);
    expect(calls.some((c) => c[0] === 'git' && c[1] === 'clone')).toBe(false);
  });

  it("'s final step spawns the clone's own check, with cwd set to opts.dir, and returns its exit code", async () => {
    // A real tmpdir standing in for "the clone": renameIdentity actually
    // writes into it, so this exercises the whole pipeline up to (but not
    // including) a real network clone or push, which `run` stubs out.
    const dir = mkdtempSync(join(tmpdir(), 'setup-create-'));
    try {
      mkdirSync(join(dir, 'apps/api'), { recursive: true });
      mkdirSync(join(dir, 'scripts/test'), { recursive: true });
      for (const rel of TELEMETRY_FILES) mkdirSync(join(dir, rel, '..'), { recursive: true });

      writeFileSync(
        join(dir, 'project.json'),
        JSON.stringify({ name: 'boris', apps: { api: { path: 'apps/api', toolchain: 'python', reads: ['apps/api'] } } }),
      );
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'boris', private: true }));
      writeFileSync(join(dir, 'apps/api/pyproject.toml'), '[project]\nname = "api"\nversion = "0.1.0"\n');
      writeFileSync(join(dir, TELEMETRY_FILES[0]!), 'name: boris-telemetry\n');
      writeFileSync(join(dir, TELEMETRY_FILES[1]!), 'uid: boris-prometheus\n');
      writeFileSync(join(dir, TELEMETRY_FILES[2]!), '  - name: boris\n');
      writeFileSync(join(dir, TELEMETRY_FILES[3]!), '{"uid": "boris-claude-code", "tags": ["claude-code", "boris"]}\n');
      writeFileSync(
        join(dir, 'CLAUDE.md'),
        ['# boris', '', '## Repository settings', '', 'Checked with `gh api repos/stevemarvell/boris`, not assumed:', '', '- a fact', ''].join(
          '\n',
        ),
      );
      writeFileSync(join(dir, 'scripts/test/identity.test.ts'), readFileSync(join(ROOT, 'scripts/test/identity.test.ts'), 'utf8'));

      const target = 'acme-owner/acme';
      const run: Run = async (cmd, args) => {
        const key = `${cmd} ${args.join(' ')}`;
        if (key === `gh api repos/${target} --jq .name`) return { status: 0, stdout: '{}', stderr: '' };
        if (key === `gh api repos/${target}/branches?per_page=1`) return { status: 0, stdout: '[]', stderr: '' };
        if (cmd === 'git' && args.includes('rev-parse')) return { status: 0, stdout: 'abc1234\n', stderr: '' };
        return { status: 0, stdout: '', stderr: '' }; // clone, remote rename/set-url/add, add, commit, push
      };

      const spawnCalls: { cmd: string; args: string[]; options?: Record<string, unknown> }[] = [];
      const spawn: Spawn = (cmd, args, options) => {
        spawnCalls.push({ cmd, args, options });
        return { status: 0 };
      };

      const exitCode = await create({ name: 'acme', owner: 'acme-owner', dir, public: false }, { run, spawn });

      expect(exitCode).toBe(0);
      const checkCall = spawnCalls.find((c) => c.cmd === 'node' && c.args[0] === 'scripts/setup.mjs' && c.args[1] === 'check');
      expect(checkCall).toBeDefined();
      expect(checkCall?.options?.cwd).toBe(dir);
      expect(checkCall?.options?.stdio).toBe('inherit');

      // And it is the clone's own copy run as a separate process, never
      // this process's own runCheck inspecting this checkout.
      expect(spawnCalls.filter((c) => c.cmd === 'node').length).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('propagates a non-zero exit from the clone\'s own check', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'setup-create-'));
    try {
      mkdirSync(join(dir, 'apps/api'), { recursive: true });
      mkdirSync(join(dir, 'scripts/test'), { recursive: true });
      for (const rel of TELEMETRY_FILES) mkdirSync(join(dir, rel, '..'), { recursive: true });
      writeFileSync(
        join(dir, 'project.json'),
        JSON.stringify({ name: 'boris', apps: { api: { path: 'apps/api', toolchain: 'python', reads: ['apps/api'] } } }),
      );
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'boris', private: true }));
      writeFileSync(join(dir, 'apps/api/pyproject.toml'), '[project]\nname = "api"\nversion = "0.1.0"\n');
      writeFileSync(join(dir, TELEMETRY_FILES[0]!), 'name: boris-telemetry\n');
      writeFileSync(join(dir, TELEMETRY_FILES[1]!), 'uid: boris-prometheus\n');
      writeFileSync(join(dir, TELEMETRY_FILES[2]!), '  - name: boris\n');
      writeFileSync(join(dir, TELEMETRY_FILES[3]!), '{"uid": "boris-claude-code", "tags": ["claude-code", "boris"]}\n');
      writeFileSync(
        join(dir, 'CLAUDE.md'),
        ['# boris', '', '## Repository settings', '', 'Checked with `gh api repos/stevemarvell/boris`, not assumed:', '', '- a fact', ''].join(
          '\n',
        ),
      );
      writeFileSync(join(dir, 'scripts/test/identity.test.ts'), readFileSync(join(ROOT, 'scripts/test/identity.test.ts'), 'utf8'));

      const target = 'acme-owner/acme';
      const run: Run = async (cmd, args) => {
        const key = `${cmd} ${args.join(' ')}`;
        if (key === `gh api repos/${target} --jq .name`) return { status: 0, stdout: '{}', stderr: '' };
        if (key === `gh api repos/${target}/branches?per_page=1`) return { status: 0, stdout: '[]', stderr: '' };
        if (cmd === 'git' && args.includes('rev-parse')) return { status: 0, stdout: 'abc1234\n', stderr: '' };
        return { status: 0, stdout: '', stderr: '' };
      };
      const spawn: Spawn = (cmd, args) => (cmd === 'node' && args[1] === 'check' ? { status: 1 } : { status: 0 });

      const exitCode = await create({ name: 'acme', owner: 'acme-owner', dir, public: false }, { run, spawn });
      expect(exitCode).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
