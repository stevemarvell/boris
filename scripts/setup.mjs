#!/usr/bin/env node
// From an empty folder to a repository ready for triage.
//
// Cloning this base carries the files, but not the secrets, labels, settings
// or owner tickets a working repository needs around them — starting a real
// repository from this base took days of hand work before this existed.
//
// Usage:
//     npm run setup -- create --name <n> --owner <o> [--dir <path>] [--public]
//     npm run setup -- check [--skip-verify] [--dry-run] [--repo owner/name]
//
// `create` is run from a checkout of this base, and is never run for real by
// an agent: it creates a GitHub repository, which is the owner's call.
// `check` is run inside a repository built from this base (including this
// one) and is idempotent — re-running it after fixing something reports less
// to do, never more, and never creates a second copy of anything it already
// made. It exits 0 only when every line is done (✔) or just fixed (✚); any
// ✋ line is something only the owner can do, with the exact command.
import { execFile, execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply as applyLabels, loadManifest as loadLabelManifest } from './labels.mjs';
import { ROOT, apps, deployed, loadProject } from './project.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const STORY_TEMPLATE_PATH = join(HERE, 'setup/story-template.md');

// The remote name a clone of this base is given, push disabled, so a clone
// can still fetch upstream improvements without ever pushing to this base by
// accident. Literal, not "the base": this is the one place that name is the
// base's own, because it is what the clone's own git config calls it.
export const BASE_REMOTE = 'boris';

export const PREFLIGHT_NODE_MAJOR = 22;

/** Runs `cmd args` and resolves to its exit status, stdout and stderr. Never rejects. */
export function exec(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ status: error?.code ?? 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
}

function reason({ stdout, stderr }) {
  return (stderr?.trim() || stdout?.trim() || '').trim();
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

/** `create`'s flags, defaulting `--dir` to `../<name>` and `--public` to false. */
export function parseCreateArgs(argv) {
  const opts = { public: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--public') {
      opts.public = true;
      continue;
    }
    const value = argv[i + 1];
    if (flag === '--name' || flag === '--owner' || flag === '--dir') {
      if (value === undefined || value.startsWith('--')) throw new Error(`usage: ${flag} needs a value`);
      opts[flag.slice(2)] = value;
      i++;
      continue;
    }
    throw new Error(`usage: create --name <n> --owner <o> [--dir <path>] [--public]: unknown flag "${flag}"`);
  }
  if (!opts.name) throw new Error('usage: --name <n> is required');
  if (!opts.owner) throw new Error('usage: --owner <o> is required');
  if (!opts.dir) opts.dir = `../${opts.name}`;
  return opts;
}

/** `check`'s flags. Every one is optional. */
export function parseCheckArgs(argv) {
  const opts = { skipVerify: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--skip-verify') {
      opts.skipVerify = true;
    } else if (flag === '--dry-run') {
      opts.dryRun = true;
    } else if (flag === '--repo') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error('usage: --repo needs a value');
      opts.repo = value;
      i++;
    } else {
      throw new Error(`usage: check [--skip-verify] [--dry-run] [--repo owner/name]: unknown flag "${flag}"`);
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Preflight (create, step 1)
// ---------------------------------------------------------------------------

/**
 * Every tool `create` needs, each `{ name, ok, detail }`. `run(cmd, args)` is
 * injected so this never shells out in a test; `nodeVersion` likewise, so a
 * test can assert both sides of the >= 22 check without the test runner's
 * own Node version deciding the answer.
 */
export async function preflight({ run = exec, nodeVersion = process.version } = {}) {
  const results = [];

  const ghAuth = await run('gh', ['auth', 'status']);
  results.push({ name: 'gh auth status', ok: ghAuth.status === 0, detail: ghAuth.status === 0 ? 'authenticated' : reason(ghAuth) });

  const git = await run('git', ['--version']);
  results.push({ name: 'git', ok: git.status === 0, detail: git.status === 0 ? git.stdout.trim() : reason(git) });

  const major = Number(String(nodeVersion).replace(/^v/, '').split('.')[0]);
  const nodeOk = Number.isFinite(major) && major >= PREFLIGHT_NODE_MAJOR;
  results.push({ name: `node >= ${PREFLIGHT_NODE_MAJOR}`, ok: nodeOk, detail: nodeVersion });

  const uv = await run('uv', ['--version']);
  results.push({ name: 'uv', ok: uv.status === 0, detail: uv.status === 0 ? uv.stdout.trim() : reason(uv) });

  const npm11 = await run('npx', ['npm@11', '--version']);
  results.push({ name: 'npx npm@11', ok: npm11.status === 0, detail: npm11.status === 0 ? npm11.stdout.trim() : reason(npm11) });

  return results;
}

/** The preflight checks that failed, named for a report. */
export function missingPreflight(results) {
  return results.filter((r) => !r.ok);
}

// ---------------------------------------------------------------------------
// Renaming the identity (create, step 4)
// ---------------------------------------------------------------------------

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `project.json` or the root `package.json`'s "name" field, renamed in place
 * if (and only if) it currently matches `oldName`. Returns whether it changed. */
export function renameJsonName(path, oldName, newName) {
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (data.name !== oldName) return false;
  data.name = newName;
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  return true;
}

/** A Python app's `pyproject.toml` `[project]` name, renamed if it currently
 * matches `oldName`. Returns whether it changed. Never touches a dependency
 * or tool name that happens to share the pattern: only the first `name = "…"`
 * line, which `[project]` puts first in every app here. */
export function renamePyproject(path, oldName, newName) {
  const text = readFileSync(path, 'utf8');
  const pattern = /^(name\s*=\s*")([^"]*)(")/m;
  const match = pattern.exec(text);
  if (!match || match[2] !== oldName) return false;
  writeFileSync(path, text.replace(pattern, `$1${newName}$3`));
  return true;
}

// The telemetry identifiers CLAUDE.md names: the compose project and the
// Grafana dashboard/datasource uids. Each file's own identifier is a whole
// word built from the old name, never a substring match (so a rename never
// touches an unrelated word that happens to contain it).
export const TELEMETRY_FILES = [
  'telemetry/docker-compose.yml',
  'telemetry/grafana/provisioning/datasources/prometheus.yml',
  'telemetry/grafana/provisioning/dashboards/dashboards.yml',
  'telemetry/grafana/dashboards/claude-code.json',
];

/** Every whole-word occurrence of `oldName` in each of TELEMETRY_FILES,
 * renamed to `newName`. Returns the files actually changed. */
export function renameTelemetry(root, oldName, newName) {
  const pattern = new RegExp(`\\b${escapeRegExp(oldName)}\\b`, 'g');
  const changed = [];
  for (const rel of TELEMETRY_FILES) {
    const path = join(root, rel);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    const updated = text.replace(pattern, newName);
    if (updated === text) continue;
    writeFileSync(path, updated);
    changed.push(rel);
  }
  return changed;
}

/**
 * CLAUDE.md's "## Repository settings" section, which names the base's own
 * GitHub path and its own repository settings, replaced with a placeholder
 * pointing at `check` instead of a guess about a repository that has not
 * been pushed yet. Everything else in CLAUDE.md — including the intro and
 * its own name — is left for the "Rewrite README and CLAUDE.md around the
 * product" owner issue `check` files: a technical rename is not a rewrite.
 *
 * Also blanks any real VERCEL_TOKEN expiry date left over from the base,
 * since that date was never this repository's own.
 */
export function placeholderClaudeMd(text, { owner, name }) {
  const heading = '## Repository settings';
  const start = text.indexOf(heading);
  if (start === -1) throw new Error('CLAUDE.md has no "## Repository settings" section');
  const bodyStart = start + heading.length;
  const nextHeading = text.indexOf('\n## ', bodyStart);
  const bodyEnd = nextHeading === -1 ? text.length : nextHeading;
  const replacement =
    `${heading}\n\n` +
    `Checked with \`gh api repos/${owner}/${name}\`, not assumed:\n\n` +
    "- Not yet checked — run `npm run setup -- check` once this repository is pushed; it fixes what it can and reports the rest.\n";
  let out = text.slice(0, start) + replacement + text.slice(bodyEnd);
  out = out.replace(/(VERCEL_TOKEN[^\n]*?)\b\d{4}-\d{2}-\d{2}\b/i, '$1<expiry>');
  return out;
}

// Every exact substring scripts/test/identity.test.ts's own ALLOW list uses
// for a fact that a rename changes. Each is replaced in the clone's copy of
// that file, so the allowlist still matches what the clone actually
// contains; each is asserted present first, so a future edit to
// identity.test.ts that moves this text fails loudly here rather than
// silently leaving the clone's allowlist stale.
function identityReplacements(oldName, newName, owner) {
  return [
    [`pattern: /gh api repos\\/stevemarvell\\/${oldName}/`, `pattern: /gh api repos\\/${owner}\\/${newName}/`],
    [`{ file: 'package.json', pattern: /"name": "${oldName}"/`, `{ file: 'package.json', pattern: /"name": "${newName}"/`],
    [`{ file: 'package-lock.json', pattern: /"name": "${oldName}"/`, `{ file: 'package-lock.json', pattern: /"name": "${newName}"/`],
    [`{ file: 'project.json', pattern: /"name": "${oldName}"/`, `{ file: 'project.json', pattern: /"name": "${newName}"/`],
    [`pattern: /name: ${oldName}-telemetry/`, `pattern: /name: ${newName}-telemetry/`],
    [
      `pattern: /${oldName}/, because: 'Grafana dashboard/datasource naming`,
      `pattern: /${newName}/, because: 'Grafana dashboard/datasource naming`,
    ],
    [`pattern: /name: ${oldName}/, because: 'Grafana provisioning naming`, `pattern: /name: ${newName}/, because: 'Grafana provisioning naming`],
    [`pattern: /uid: ${oldName}-prometheus/`, `pattern: /uid: ${newName}-prometheus/`],
  ];
}

/**
 * The clone's own copy of scripts/test/identity.test.ts, with every ALLOW
 * entry the rename invalidates rewritten to match what the clone actually
 * contains afterwards. Everything else — the entries for files a technical
 * rename deliberately leaves alone (CLAUDE.md's own name, the sync-ai-layer
 * convention, the frozen step-0 artifact, and so on) — is untouched, because
 * those stay true in the clone exactly as they are in the base.
 *
 * Throws, rather than silently doing nothing, if a replacement's source text
 * is not found: a present-but-inert rewrite is the one failure shape this
 * repository keeps re-discovering (docs/sops.md SOP 3), and this function
 * would be a textbook case of it.
 */
export function rewriteIdentityTestForClone(source, { oldName, newName, owner }) {
  let out = source;
  for (const [from, to] of identityReplacements(oldName, newName, owner)) {
    if (!out.includes(from)) throw new Error(`identity.test.ts rewrite: expected to find ${JSON.stringify(from)}`);
    out = out.replaceAll(from, to);
  }
  return out;
}

/**
 * Every identity rename `create` makes, against a checkout at `root`. Pure
 * filesystem work — no network, no git — so it is the same function whether
 * it runs for real or against a fixture directory in a test.
 */
export function renameIdentity({ root, oldName, newName, owner, project }) {
  const changed = [];
  if (renameJsonName(join(root, 'project.json'), oldName, newName)) changed.push('project.json');
  if (renameJsonName(join(root, 'package.json'), oldName, newName)) changed.push('package.json');
  for (const [appName, app] of apps(project, 'python')) {
    const pyproject = join(root, app.path, 'pyproject.toml');
    if (existsSync(pyproject) && renamePyproject(pyproject, oldName, newName)) changed.push(`${app.path}/pyproject.toml (${appName})`);
  }
  changed.push(...renameTelemetry(root, oldName, newName));

  const claudeMdPath = join(root, 'CLAUDE.md');
  writeFileSync(claudeMdPath, placeholderClaudeMd(readFileSync(claudeMdPath, 'utf8'), { owner, name: newName }));
  changed.push('CLAUDE.md');

  const identityTestPath = join(root, 'scripts/test/identity.test.ts');
  writeFileSync(identityTestPath, rewriteIdentityTestForClone(readFileSync(identityTestPath, 'utf8'), { oldName, newName, owner }));
  changed.push('scripts/test/identity.test.ts');

  return changed;
}

// ---------------------------------------------------------------------------
// check: the list, and what it means for the exit code
// ---------------------------------------------------------------------------

export const MARK = { done: '✔', fixed: '✚', owner: '✋' };

/** `results` (each `{ mark, text }`) rendered as the printed lines, and the
 * exit code: 0 iff no ✋ remains. */
export function renderCheck(results) {
  return {
    lines: results.map((r) => `${r.mark} ${r.text}`),
    exitCode: results.some((r) => r.mark === MARK.owner) ? 1 : 0,
  };
}

/** Whether `develop` should get branch protection now, or wait on discipline:
 * public repositories can have it; a private one on the free plan cannot
 * (CLAUDE.md, "No paid tiers" — rulesets and classic branch protection both
 * return 403 there). */
export function branchProtectionDecision({ isPrivate }) {
  if (!isPrivate) {
    return { mark: MARK.fixed, text: 'branch protection: enabling classic protection on develop requiring the verify check' };
  }
  return {
    mark: MARK.done,
    text: 'branch protection: private, free-plan repository — enforced by discipline (docs/sops.md SOP 1), not mechanically',
  };
}

// The owner issues `check` files, each matched by exact title so a re-run
// never duplicates one. Every one carries `human` + `do not automate`
// (docs/sops.md SOP 2) plus its own rank.
export const OWNER_ISSUES = [
  {
    title: 'Add CLAUDE_CODE_OAUTH_TOKEN',
    rank: 'critical',
    body:
      'Run `claude setup-token`, then `gh secret set CLAUDE_CODE_OAUTH_TOKEN` with the value it prints. ' +
      'Without this secret, both the code and security reviews error on every pull request — do this before the first one.',
  },
  {
    title: 'Optional: Telegram notifications',
    rank: 'medium',
    body:
      'Set the `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` repository secrets to get a message when a pull request merges. ' +
      'Skip this and merges are silent; nothing else here depends on it.',
  },
  {
    title: 'Optional: Grafana CI telemetry',
    rank: 'medium',
    body:
      'Set the `GRAFANA_CLOUD_OTLP_ENDPOINT` and `GRAFANA_CLOUD_OTLP_AUTH` repository secrets to send Claude Code '
      + "CI usage to Grafana Cloud (telemetry/README.md). Skip this and CI telemetry goes nowhere; local sessions are unaffected.",
  },
  {
    title: "Merge Dependabot's first PR",
    rank: 'high',
    body:
      "Dependabot opens its first pull request once there is a dependency to bump. Review and merge it so the " +
      'dependency-update loop is proven to work end to end, not just configured.',
  },
  {
    title: 'Rewrite README and CLAUDE.md around the product',
    rank: 'high',
    body:
      '`setup create` only renames identifiers — project.json, package.json, telemetry, and the Repository settings ' +
      "section. The intro, Layout and Deployments sections still describe this base's own placeholder shells. Rewrite " +
      'them once this repository has a real application; see CLAUDE.md\'s own rule that a shared file never names the ' +
      'repository it sits in.',
  },
];

/** Which of OWNER_ISSUES don't already exist — open or closed, so a person
 * closing one by hand doesn't get it recreated — by exact title. */
export function missingOwnerIssues(existingTitles) {
  const have = new Set(existingTitles);
  return OWNER_ISSUES.filter((issue) => !have.has(issue.title));
}

export const TEMPLATE_ISSUE_TITLE = 'Template: User story';

/** Whether an open issue already carries the `template` label — if one does,
 * creating another would be the duplicate `check` promises never to make. */
export function needsTemplateIssue(openIssues) {
  return !openIssues.some((issue) => (issue.labels ?? []).includes('template'));
}

// ---------------------------------------------------------------------------
// check: orchestration
// ---------------------------------------------------------------------------

/** `gh repo view`'s JSON, narrowed to what `check` reads. */
async function repoView(run, repo) {
  const args = ['repo', 'view', '--json', 'isPrivate,deleteBranchOnMerge,url'];
  if (repo) args.push(repo);
  const result = await run('gh', args);
  if (result.status !== 0) throw new Error(`gh repo view failed: ${reason(result)}`);
  return JSON.parse(result.stdout);
}

async function ghJson(run, args) {
  const result = await run('gh', args);
  if (result.status !== 0) throw new Error(`gh ${args.join(' ')} failed: ${reason(result)}`);
  return JSON.parse(result.stdout);
}

/** `text`, capped to `maxLen` characters from the end — the failure is in the
 * last lines of a test run, not the first — with a note that it was cut. */
function trimOutput(text, maxLen = 3000) {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `… (truncated)\n${trimmed.slice(-maxLen)}`;
}

/**
 * Runs the real `scripts/test/identity.test.ts`, rather than re-deriving a
 * second copy of what it allows: a duplicate list is exactly how the two
 * would quietly drift apart and start disagreeing with each other, which is
 * what the first live run of this check actually did (docs/sops.md SOP 3).
 */
function runIdentityCensus() {
  try {
    // Through a shell on purpose, like verify-apps.mjs's own npm/uv
    // invocations: npx is a .cmd shim on Windows.
    const output = execSync('npx vitest run --root scripts/test identity.test.ts', { cwd: ROOT, encoding: 'utf8' });
    return { ok: true, output };
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim() || error.message;
    return { ok: false, output };
  }
}

/**
 * Runs `check` for real: every line `npm run setup -- check` prints, and the
 * exit code. `run` defaults to the real `gh`/`git`; `fetchUrl` to the real
 * `fetch`; `runVerify` and `runIdentityTest` to actually spawning `npm run
 * verify` and the identity test. Each is injectable so a test can drive this
 * without the network — though this repository's own test list only asks
 * for the pure pieces above; this function is exercised for real, with
 * `--dry-run`, and its output goes in the pull request body (docs/sops.md
 * SOP 3: a control is verified where it runs, not only in a unit test).
 */
export async function runCheck({
  repo,
  root = ROOT,
  dryRun = false,
  skipVerify = false,
  run = exec,
  fetchUrl = fetch,
  runVerify,
  runIdentityTest = runIdentityCensus,
} = {}) {
  const results = [];
  const repoArg = (args) => (repo ? [...args, '--repo', repo] : args);

  // Labels
  const manifest = loadLabelManifest();
  const labelActions = await applyLabels({ run: (args) => run('gh', args), manifest, repo, dryRun, log: () => {} });
  results.push(
    labelActions.length === 0
      ? { mark: MARK.done, text: 'labels match labels.json' }
      : { mark: MARK.fixed, text: `labels: ${labelActions.map((a) => `${a.action} ${a.name}`).join(', ')}` },
  );

  // delete_branch_on_merge, and the repository's visibility for the branch
  // protection decision below.
  const view = await repoView(run, repo);
  if (view.deleteBranchOnMerge) {
    results.push({ mark: MARK.done, text: 'delete_branch_on_merge is already on' });
  } else if (dryRun) {
    results.push({ mark: MARK.owner, text: 'would enable delete_branch_on_merge: gh repo edit --delete-branch-on-merge' });
  } else {
    const edit = await run('gh', repoArg(['repo', 'edit', '--delete-branch-on-merge']));
    if (edit.status !== 0) throw new Error(`gh repo edit --delete-branch-on-merge failed: ${reason(edit)}`);
    results.push({ mark: MARK.fixed, text: 'enabled delete_branch_on_merge' });
  }

  // Branch protection
  const protection = branchProtectionDecision({ isPrivate: view.isPrivate });
  if (protection.mark === MARK.fixed && dryRun) {
    results.push({ mark: MARK.owner, text: `would set branch protection: ${protection.text}` });
  } else if (protection.mark === MARK.fixed) {
    // `gh api` takes no --repo flag of its own: the repository comes from
    // the path itself, so a given `repo` is spliced into it directly
    // instead of going through repoArg, and gh's own {owner}/{repo}
    // placeholders (resolved from the cwd's git remote) cover the default.
    const branchArgs = [
      'api',
      `repos/${repo ?? '{owner}/{repo}'}/branches/develop/protection`,
      '-X',
      'PUT',
      '-f',
      'required_status_checks[strict]=true',
      '-f',
      'required_status_checks[contexts][]=verify',
      '-F',
      'enforce_admins=true',
      '-F',
      'required_pull_request_reviews=null',
      '-F',
      'restrictions=null',
    ];
    const protect = await run('gh', branchArgs);
    results.push(
      protect.status === 0
        ? protection
        : { mark: MARK.owner, text: `branch protection: gh could not set it (${reason(protect)}) — set it by hand on develop, requiring "verify"` },
    );
  } else {
    results.push(protection);
  }

  // CLAUDE_CODE_OAUTH_TOKEN, by name only
  const secrets = await ghJson(run, repoArg(['secret', 'list', '--json', 'name']));
  const secretNames = new Set(secrets.map((s) => s.name));
  results.push(
    secretNames.has('CLAUDE_CODE_OAUTH_TOKEN')
      ? { mark: MARK.done, text: 'CLAUDE_CODE_OAUTH_TOKEN is set' }
      : {
          mark: MARK.owner,
          text: 'CLAUDE_CODE_OAUTH_TOKEN is missing — run `claude setup-token`, then `gh secret set CLAUDE_CODE_OAUTH_TOKEN` — before the first PR, or every review errors',
        },
  );

  // Owner issues, deduplicated by title
  const allIssues = await ghJson(run, repoArg(['issue', 'list', '--state', 'all', '--limit', '500', '--json', 'title']));
  const missing = missingOwnerIssues(allIssues.map((i) => i.title));
  for (const issue of missing) {
    const label = [issue.rank, 'human', 'do not automate'];
    if (dryRun) {
      results.push({ mark: MARK.owner, text: `would file owner issue "${issue.title}"` });
      continue;
    }
    const createArgs = repoArg([
      'issue',
      'create',
      '--title',
      issue.title,
      '--body',
      issue.body,
      ...label.flatMap((l) => ['--label', l]),
      '--assignee',
      '@me',
    ]);
    const created = await run('gh', createArgs);
    results.push(
      created.status === 0
        ? { mark: MARK.fixed, text: `filed owner issue "${issue.title}"` }
        : { mark: MARK.owner, text: `could not file "${issue.title}" (${reason(created)}) — file it by hand, labelled human + do not automate` },
    );
  }
  if (missing.length === 0) results.push({ mark: MARK.done, text: 'every owner issue already exists' });

  // Story template issue
  const openIssues = await ghJson(run, repoArg(['issue', 'list', '--state', 'open', '--limit', '500', '--json', 'labels']));
  if (!needsTemplateIssue(openIssues)) {
    results.push({ mark: MARK.done, text: 'a template issue is already open' });
  } else if (dryRun) {
    results.push({ mark: MARK.owner, text: `would file "${TEMPLATE_ISSUE_TITLE}" from ${STORY_TEMPLATE_PATH}` });
  } else {
    const body = readFileSync(STORY_TEMPLATE_PATH, 'utf8');
    const created = await run('gh', repoArg(['issue', 'create', '--title', TEMPLATE_ISSUE_TITLE, '--body', body, '--label', 'template']));
    results.push(
      created.status === 0
        ? { mark: MARK.fixed, text: `filed "${TEMPLATE_ISSUE_TITLE}"` }
        : { mark: MARK.owner, text: `could not file "${TEMPLATE_ISSUE_TITLE}" (${reason(created)}) — copy it by hand from scripts/setup/story-template.md, labelled template` },
    );
  }

  // Identity census: the real test, not a second copy of what it allows.
  const census = await runIdentityTest();
  results.push(
    census.ok
      ? { mark: MARK.done, text: 'identity census: scripts/test/identity.test.ts passes' }
      : { mark: MARK.owner, text: `identity census: scripts/test/identity.test.ts failed —\n${trimOutput(census.output)}` },
  );

  // Deploy checks, one per app with a deploy block
  const project = loadProject(join(root, 'project.json'));
  const deployedApps = deployed(project);
  if (deployedApps.length === 0) {
    results.push({ mark: MARK.done, text: 'no app has a deploy block — nothing to check' });
  } else {
    for (const [name, app] of deployedApps) {
      let reachable = false;
      try {
        const response = await fetchUrl(app.deploy.url, { signal: AbortSignal.timeout(10_000) });
        const body = await response.text();
        reachable = response.status === 200 && !/sign.?in|authenticate|vercel\.com\/sso/i.test(body);
      } catch {
        reachable = false;
      }
      results.push(
        reachable
          ? { mark: MARK.done, text: `${name}: ${app.deploy.url} answers 200 with no login page` }
          : { mark: MARK.owner, text: `${name}: ${app.deploy.url} did not answer 200 with no login page — check deployment protection is off` },
      );
      const hasToken = secretNames.has('VERCEL_TOKEN');
      results.push(
        hasToken
          ? { mark: MARK.done, text: 'VERCEL_TOKEN is set' }
          : { mark: MARK.owner, text: 'VERCEL_TOKEN is missing — add a team-scoped token before the next deploy' },
      );
      const readmePath = join(root, 'README.md');
      const readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : '';
      const expiryRecorded = /VERCEL_TOKEN[^\n]*\d{4}-\d{2}-\d{2}/i.test(readme);
      results.push(
        expiryRecorded
          ? { mark: MARK.done, text: "VERCEL_TOKEN's expiry is recorded" }
          : { mark: MARK.owner, text: "VERCEL_TOKEN's expiry is not recorded — add it to README.md's secrets table" },
      );
    }
  }

  // npm run verify
  if (skipVerify) {
    results.push({ mark: MARK.done, text: 'npm run verify: skipped (--skip-verify)' });
  } else {
    const verify = runVerify ? runVerify() : spawnSync('npm', ['run', 'verify'], { stdio: 'inherit' }).status ?? 1;
    results.push(
      verify === 0
        ? { mark: MARK.done, text: 'npm run verify passes' }
        : { mark: MARK.owner, text: `npm run verify is red (exit ${verify}) — fix it before anything else` },
    );
  }

  const { lines, exitCode } = renderCheck(results);
  const footer = [
    '',
    'Next steps:',
    '- File the backlog: issues ranked critical/high/medium, with "Depends on #n" lines and acceptance criteria.',
    '- Ship one small pull request end to end, and confirm both reviews post real verdicts, not just green checks.',
    '- `npm run deploy:add -- vercel --app <app> ...` once an app should actually deploy.',
    '- Then the `work-backlog` skill picks up the rest.',
  ];
  return { lines: [...lines, ...footer], exitCode };
}

// ---------------------------------------------------------------------------
// create: orchestration
// ---------------------------------------------------------------------------

/**
 * Whether `target` is safe for `create` to clone into: either it doesn't
 * exist yet, or `gh repo view` reports it `isEmpty`. Fails closed: any
 * non-zero status or unparseable JSON from the emptiness check itself
 * throws with `gh`'s own stderr, rather than falling through to "assume
 * empty" the way a `gh api .../commits` call failing used to. Proceeds only
 * on the positive answer `isEmpty === true` — not "no commits found", which
 * a failed call can also look like.
 */
export async function ensureEmptyTarget({ run, target }) {
  const view = await run('gh', ['repo', 'view', target, '--json', 'name']);
  if (view.status !== 0) return { exists: false }; // does not exist yet; create() will create it

  const empty = await run('gh', ['repo', 'view', target, '--json', 'isEmpty']);
  if (empty.status !== 0) throw new Error(`gh repo view ${target} --json isEmpty failed: ${reason(empty)}`);
  let isEmpty;
  try {
    isEmpty = JSON.parse(empty.stdout).isEmpty;
  } catch {
    throw new Error(`gh repo view ${target} --json isEmpty returned unparseable JSON: ${empty.stdout}`);
  }
  if (isEmpty !== true) throw new Error(`setup create: ${target} already exists and is not empty`);
  return { exists: true };
}

/**
 * `create`, run for real. Only `ensureEmptyTarget` (above) and the pieces
 * above it (parseCreateArgs, preflight, renameIdentity and its parts) carry
 * this repository's own test coverage for it — the rest clones a few
 * hundred megabytes and pushes, which is the owner's call and not safe to
 * run from a test. `run` and `spawn` are both injectable, so a test can
 * drive every step — including the final one below — without any of that.
 *
 * Returns `check`'s exit code, from the *clone's own copy* of this script,
 * run as a separate process with `cwd: opts.dir`. It must not call
 * `runCheck` in this process: this process's own `loadProject()`, the
 * identity census, and the README read would all inspect this checkout —
 * the base being cloned *from* — not the new repository `check` is meant to
 * grade. A separate `node scripts/setup.mjs check` under the clone's own
 * `cwd` resolves `project.json`, `README.md` and even `scripts/setup.mjs`
 * itself from the clone, because that is where that process's own `ROOT`
 * and relative reads land.
 */
export async function create(opts, { run = exec, spawn = spawnSync } = {}) {
  const results = await preflight({ run });
  const missing = missingPreflight(results);
  if (missing.length > 0) {
    throw new Error(`setup create: missing ${missing.map((m) => m.name).join(', ')}`);
  }

  const target = `${opts.owner}/${opts.name}`;
  const { exists } = await ensureEmptyTarget({ run, target });
  if (!exists) {
    const created = await run('gh', ['repo', 'create', target, opts.public ? '--public' : '--private']);
    if (created.status !== 0) throw new Error(`gh repo create ${target} failed: ${reason(created)}`);
  }

  const clone = await run('git', ['clone', '--branch', 'develop', 'git@github.com:stevemarvell/boris.git', opts.dir]);
  if (clone.status !== 0) throw new Error(`git clone failed: ${reason(clone)}`);

  const git = (args) => run('git', ['-C', opts.dir, ...args]);
  await git(['remote', 'rename', 'origin', BASE_REMOTE]);
  await git(['remote', 'set-url', '--push', BASE_REMOTE, 'DISABLED']);
  await git(['remote', 'add', 'origin', `git@github.com:${target}.git`]);

  const project = loadProject(join(opts.dir, 'project.json'));
  renameIdentity({ root: opts.dir, oldName: project.name, newName: opts.name, owner: opts.owner, project });

  spawn('npx', ['npm@11', 'install'], { cwd: opts.dir, stdio: 'inherit' });
  for (const [, app] of apps(project, 'python')) {
    spawn('uv', ['lock', '--directory', join(opts.dir, app.path)], { stdio: 'inherit' });
  }

  spawn('npm', ['run', 'bootstrap'], { cwd: opts.dir, stdio: 'inherit' });
  const verify = spawn('npm', ['run', 'verify'], { cwd: opts.dir, stdio: 'inherit' });
  if ((verify.status ?? 1) !== 0) throw new Error('setup create: npm run verify failed in the clone');

  await git(['add', '-A']);
  const sha = await run('git', ['-C', opts.dir, 'rev-parse', '--short', `${BASE_REMOTE}/develop`]);
  await git(['commit', '-m', `Start ${opts.name} from boris@${sha.stdout.trim()}`]);
  const push = await git(['push', '-u', 'origin', 'develop']);
  if (push.status !== 0) throw new Error(`git push failed: ${reason(push)}`);

  const check = spawn('node', ['scripts/setup.mjs', 'check'], { cwd: opts.dir, stdio: 'inherit' });
  return check.status ?? 1;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export async function main(argv) {
  const [command, ...rest] = argv;
  if (command === 'create') {
    const opts = parseCreateArgs(rest);
    // create() prints nothing of its own beyond here: every step's output,
    // including the clone's own `check` at the end, is already streamed
    // live via inherited stdio.
    return await create(opts);
  }
  if (command === 'check') {
    const opts = parseCheckArgs(rest);
    const result = await runCheck(opts);
    process.stdout.write(result.lines.join('\n') + '\n');
    return result.exitCode;
  }
  throw new Error('usage: setup.mjs create --name <n> --owner <o> [--dir <path>] [--public] | check [--skip-verify] [--dry-run] [--repo owner/name]');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2))
    .then((exitCode) => process.exit(exitCode))
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
