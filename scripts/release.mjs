// The mechanical parts of a release (docs/releases.md, the `release` skill):
// the tag name, the notes, whether the owner has said `go`, and the REST calls
// that cut and finish a release. GitHub is reached through `gh api` (REST), never
// `gh pr`, `gh release` or `gh issue`, which are GraphQL and refused in cloud
// sessions (#225). `run(cmd, args)` is injected so a test never shells out.
//
// Usage (the coordinator, from a checkout of the product):
//     node scripts/release.mjs plan   [--repo o/n] [--date YYYY-MM-DD]   # next tag and notes, as JSON
//     node scripts/release.mjs go     --pr <n> [--repo o/n]              # exit 0 iff the owner said go or merged it
//     node scripts/release.mjs tag    --pr <n> [--repo o/n] [--date ...]  # tag the merge commit and create the GitHub Release
// Nothing here merges: the merge of a release pull request stays with the
// coordinator, after `go`. Ceiling: one page walk of PAGE_LIMIT pages of 100.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const PAGE_LIMIT = 5;
const TAG = /^v(\d{4})\.(\d{2})\.(\d{2})(?:-(\d+))?$/;

/** `vYYYY.MM.DD` for a date (a Date or an ISO date string), in UTC. */
export function baseTag(date) {
  const d = typeof date === 'string' ? new Date(`${date.slice(0, 10)}T00:00:00Z`) : date;
  if (Number.isNaN(d.getTime())) throw new Error(`release: not a date: ${String(date)}`);
  return `v${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** The next tag for `date` given the tags that exist: `vYYYY.MM.DD`, then `-2`, `-3`... for further releases that day. */
export function nextTag(existingTags, date) {
  const base = baseTag(date);
  let highest = 0;
  for (const tag of existingTags) {
    const m = TAG.exec(tag);
    if (!m || `v${m[1]}.${m[2]}.${m[3]}` !== base) continue;
    highest = Math.max(highest, m[4] ? Number(m[4]) : 1);
  }
  return highest === 0 ? base : `${base}-${highest + 1}`;
}

/** The newest release tag by date then suffix, or null when there is none. Tags that are not CalVer are ignored. */
export function latestTag(tags) {
  const key = (t) => {
    const m = TAG.exec(t);
    return m ? Number(m[1]) * 1e8 + Number(m[2]) * 1e6 + Number(m[3]) * 1e4 + (m[4] ? Number(m[4]) : 1) : -1;
  };
  const valid = tags.filter((t) => key(t) >= 0).sort((a, b) => key(b) - key(a));
  return valid[0] ?? null;
}

/**
 * Release notes: one line per pull request merged into develop after `since`
 * (an ISO time; null for the first release), oldest first, title and link.
 * `pulls` are REST pull objects ({ number, title, html_url, merged_at, base: { ref } }).
 */
export function releaseNotes(pulls, { since = null, branch = 'develop' } = {}) {
  const sinceMs = since ? Date.parse(since) : -Infinity;
  const merged = pulls
    .filter((p) => p.merged_at && p.base?.ref === branch && Date.parse(p.merged_at) > sinceMs)
    .sort((a, b) => Date.parse(a.merged_at) - Date.parse(b.merged_at));
  if (merged.length === 0) return 'No pull requests merged since the last release.';
  return merged.map((p) => `- ${p.title} ([#${p.number}](${p.html_url}))`).join('\n');
}

/**
 * Whether the owner has released: a comment `go` (case-insensitive, trimmed,
 * optional trailing full stop) whose author login is `owner`, or the owner
 * having merged the pull request. Author login only: a stranger's `go`, or a
 * bot's, is ignored, and so is a comment that merely contains the word.
 */
export function ownerSaidGo({ owner, comments, mergedBy = null }) {
  const me = String(owner).toLowerCase();
  if (mergedBy && String(mergedBy).toLowerCase() === me) return true;
  return comments.some((c) => String(c.user?.login ?? '').toLowerCase() === me && /^go\.?$/i.test(String(c.body ?? '').trim()));
}

async function api(run, route, args = []) {
  const r = await run('gh', ['api', route, ...args]);
  if (r.status !== 0) throw new Error(`gh api ${route} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}

async function pages(run, route) {
  const all = [];
  for (let page = 1; page <= PAGE_LIMIT; page++) {
    const batch = await api(run, `${route}${route.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    all.push(...batch);
    if (batch.length < 100) return all;
  }
  throw new Error(`release: ${route} has more than ${PAGE_LIMIT * 100} entries; stopping at the declared ceiling`);
}

/** The next tag and the notes for a release cut now. */
export async function plan({ run, repo, date }) {
  const tags = (await pages(run, `repos/${repo}/tags`)).map((t) => t.name);
  const last = latestTag(tags);
  let since = null;
  if (last) {
    const commit = await api(run, `repos/${repo}/commits/${last}`);
    since = commit.commit.committer.date;
  }
  const pulls = await pages(run, `repos/${repo}/pulls?state=closed&base=develop&sort=updated&direction=desc`);
  return { tag: nextTag(tags, date), since, last, notes: releaseNotes(pulls, { since }) };
}

/** True when the owner (the repository's owner login) has said go or merged the pull request. */
export async function goGiven({ run, repo, pr }) {
  const owner = repo.split('/')[0];
  const pull = await api(run, `repos/${repo}/pulls/${pr}`);
  const comments = await pages(run, `repos/${repo}/issues/${pr}/comments`);
  return ownerSaidGo({ owner, comments, mergedBy: pull.merged ? pull.merged_by?.login : null });
}

/** Tag the merge commit of a merged release pull request and create the GitHub Release with the pull request's body as notes. */
export async function tagRelease({ run, repo, pr, date }) {
  const pull = await api(run, `repos/${repo}/pulls/${pr}`);
  if (!pull.merged || pull.base.ref !== 'main') throw new Error(`release: #${pr} is not a merged pull request into main`);
  const tags = (await pages(run, `repos/${repo}/tags`)).map((t) => t.name);
  const tag = nextTag(tags, date);
  await api(run, `repos/${repo}/git/refs`, ['-X', 'POST', '-f', `ref=refs/tags/${tag}`, '-f', `sha=${pull.merge_commit_sha}`]);
  const release = await api(run, `repos/${repo}/releases`, ['-X', 'POST', '-f', `tag_name=${tag}`, '-f', `name=${tag}`, '-f', `body=${pull.body ?? ''}`]);
  return { tag, sha: pull.merge_commit_sha, url: release.html_url };
}

export const exec = async (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

function flag(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [command, ...argv] = process.argv.slice(2);
  let repo = flag(argv, '--repo');
  if (!repo) repo = (await exec('gh', ['api', 'repos/{owner}/{repo}', '--jq', '.full_name'])).stdout.trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`release: --repo must look like owner/name, got ${JSON.stringify(repo)}`);
  const date = flag(argv, '--date') ?? new Date();
  const pr = flag(argv, '--pr');
  if ((command === 'go' || command === 'tag') && !/^\d+$/.test(pr ?? '')) throw new Error('release: --pr <number> is required');
  if (command === 'plan') console.log(JSON.stringify(await plan({ run: exec, repo, date }), null, 2));
  else if (command === 'go') {
    const given = await goGiven({ run: exec, repo, pr });
    console.log(given ? 'go given' : 'waiting for the owner: no go from the owner and not merged by them');
    process.exit(given ? 0 : 1);
  } else if (command === 'tag') console.log(JSON.stringify(await tagRelease({ run: exec, repo, pr, date }), null, 2));
  else throw new Error('usage: release.mjs plan|go|tag [--repo o/n] [--pr n] [--date YYYY-MM-DD]');
}
