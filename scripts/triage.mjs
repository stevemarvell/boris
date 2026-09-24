// Decide which open issues an agent should work, and in what order.
//
// This is the "dynamic" half of step 3: the work is chosen from repository
// state rather than written in advance. The choice is still made by fixed
// rules, not by judgement, so that it can be tested and read back:
//
// 1. Skip anything a person owns: `human`, `do not automate`, or any
//    `blocked…` label (CLAUDE.md: work that needs a person is labelled, not
//    attempted).
// 2. Skip anything already in flight: an open pull request whose body names
//    the issue with Closes/Fixes/Resolves/Refs.
// 3. Skip anything whose body says "Depends on #<n>" for an issue still open.
// 4. Order the rest by the one scale (SOP 5): critical, high, medium, then
//    unranked. Within a rank, `security` first, then oldest first.
// 5. Take at most MAX_ISSUES_PER_RUN of them (SOP 1). The rest are reported
//    as deferred, not dropped.
//
// The `work-backlog` skill runs this, works what it picks, and runs it again
// after each merge — so a merge that closes an issue, or a smoke failure that
// opens one, changes what comes next.
//
// Usage: node scripts/triage.mjs [--json]   (prints the plan; changes nothing)
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** Issues one run of `work-backlog` may take on. Declared in docs/sops.md. */
export const MAX_ISSUES_PER_RUN = 3;

/** How many issues and pull requests are fetched. Hitting it is reported. */
export const FETCH_LIMIT = 200;

const RANK = { critical: 0, high: 1, medium: 2 };
const UNRANKED = 3;

const PERSON = (label) => label === 'human' || label === 'do not automate' || label.startsWith('blocked');

/** Issue numbers an open pull request already claims. */
export function claimedIssues(pullRequests) {
  const claimed = new Map();
  const pattern = /\b(?:closes|fixes|resolves|refs)\s+#(\d+)/gi;
  for (const pr of pullRequests) {
    for (const match of (pr.body ?? '').matchAll(pattern)) {
      claimed.set(Number(match[1]), pr.number);
    }
  }
  return claimed;
}

/** Open issues this issue's body says it depends on. */
export function openDependencies(issue, openNumbers) {
  const deps = [...(issue.body ?? '').matchAll(/depends on #(\d+)/gi)].map((m) => Number(m[1]));
  return deps.filter((n) => openNumbers.has(n));
}

// Own properties only: a label named `constructor` or `toString` would
// otherwise read Object.prototype's, rank as NaN, and break the sort.
function rankOf(labels) {
  return Math.min(UNRANKED, ...labels.map((l) => (Object.hasOwn(RANK, l) ? RANK[l] : UNRANKED)));
}

/**
 * @param issues        [{ number, title, labels: string[], body }]
 * @param pullRequests  open PRs: [{ number, body }]
 * @returns {{ work, deferred, skip }} work is at most MAX_ISSUES_PER_RUN long
 */
export function triage(issues, pullRequests, max = MAX_ISSUES_PER_RUN) {
  const openNumbers = new Set(issues.map((i) => i.number));
  const claimed = claimedIssues(pullRequests);
  const eligible = [];
  const skip = [];

  for (const issue of issues) {
    const person = issue.labels.filter(PERSON);
    if (person.length) {
      skip.push({ number: issue.number, title: issue.title, reason: `needs a person (${person.join(', ')})` });
      continue;
    }
    if (claimed.has(issue.number)) {
      skip.push({ number: issue.number, title: issue.title, reason: `in flight in #${claimed.get(issue.number)}` });
      continue;
    }
    const deps = openDependencies(issue, openNumbers);
    if (deps.length) {
      skip.push({ number: issue.number, title: issue.title, reason: `depends on open ${deps.map((n) => `#${n}`).join(', ')}` });
      continue;
    }
    eligible.push({
      number: issue.number,
      title: issue.title,
      rank: rankOf(issue.labels),
      security: issue.labels.includes('security'),
    });
  }

  eligible.sort((a, b) => a.rank - b.rank || Number(b.security) - Number(a.security) || a.number - b.number);
  const ordered = eligible.map(({ number, title, rank }) => ({
    number,
    title,
    rank: Object.keys(RANK)[rank] ?? 'unranked',
  }));
  return {
    work: ordered.slice(0, max),
    deferred: ordered.slice(max),
    skip: skip.sort((a, b) => a.number - b.number),
  };
}

/** The plan as text, for a person or a pull request body to read. */
export function render({ work, deferred, skip }, { truncated = false } = {}) {
  const lines = [`Work, in order (at most ${MAX_ISSUES_PER_RUN} per run):`];
  if (work.length === 0) lines.push('  nothing an agent may take on');
  for (const w of work) lines.push(`  #${w.number} [${w.rank}] ${w.title}`);
  if (deferred.length) {
    lines.push('Deferred to the next run (over the ceiling):');
    for (const d of deferred) lines.push(`  #${d.number} [${d.rank}] ${d.title}`);
  }
  lines.push('Skip:');
  for (const s of skip) lines.push(`  #${s.number} ${s.reason}: ${s.title}`);
  if (truncated) lines.push(`WARNING: a listing hit ${FETCH_LIMIT} results; the plan may be incomplete.`);
  return lines.join('\n') + '\n';
}

function gh(args) {
  return JSON.parse(execFileSync('gh', args, { encoding: 'utf8' }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const limit = String(FETCH_LIMIT);
  const issues = gh(['issue', 'list', '--state', 'open', '--limit', limit, '--json', 'number,title,labels,body']).map(
    (i) => ({ ...i, labels: i.labels.map((l) => l.name) }),
  );
  const prs = gh(['pr', 'list', '--state', 'open', '--limit', limit, '--json', 'number,body']);
  const truncated = issues.length >= FETCH_LIMIT || prs.length >= FETCH_LIMIT;
  const plan = triage(issues, prs);
  process.stdout.write(
    process.argv.includes('--json') ? JSON.stringify({ ...plan, truncated }, null, 2) + '\n' : render(plan, { truncated }),
  );
}
