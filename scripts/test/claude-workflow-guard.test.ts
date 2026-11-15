import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// On a public repository anyone can comment `@claude`. claude.yml's job holds
// CLAUDE_CODE_OAUTH_TOKEN and the Grafana credentials, so each trigger event it
// listens to must be gated on author_association in the job's `if:`. This
// parses the file CI runs; it does not copy its logic.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WORKFLOW = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'claude.yml'), 'utf8');

interface Workflow {
  on: Record<string, unknown>;
  jobs: Record<string, { if?: string }>;
}

/** Every `job/event` whose `if:` does not check author_association for that event. */
function unguarded(source: string): string[] {
  const wf = parse(source) as Workflow;
  const events = Object.keys(wf.on);
  const bad: string[] = [];
  for (const [name, job] of Object.entries(wf.jobs)) {
    const condition = String(job.if ?? '');
    for (const event of events) {
      const marker = `github.event_name == '${event}'`;
      const at = condition.indexOf(marker);
      if (at < 0) {
        bad.push(`${name}/${event}`);
        continue;
      }
      const rest = condition.slice(at + marker.length);
      const next = rest.indexOf('github.event_name ==');
      const branch = next < 0 ? rest : rest.slice(0, next);
      if (!branch.includes('author_association')) bad.push(`${name}/${event}`);
    }
  }
  return bad;
}

describe('claude.yml author_association guard', () => {
  it('guards every trigger event of every job', () => {
    expect(unguarded(WORKFLOW)).toEqual([]);
  });

  it('is not vacuous: it checks the three comment and review events', () => {
    expect(Object.keys((parse(WORKFLOW) as Workflow).on).sort()).toEqual([
      'issue_comment',
      'pull_request_review',
      'pull_request_review_comment',
    ]);
  });

  it('fails when the guard is removed from one branch', () => {
    const mutated = WORKFLOW.replace(
      /contains\(fromJSON\([^\n]*github\.event\.review\.author_association\)/,
      'true',
    );
    expect(mutated).not.toBe(WORKFLOW);
    expect(unguarded(mutated)).toEqual(['claude/pull_request_review']);
  });

  it('fails when a job has no condition at all', () => {
    const mutated = WORKFLOW.replace(/\n {4}if: \|[\s\S]*?\n {4}runs-on:/, '\n    runs-on:');
    expect(mutated).not.toBe(WORKFLOW);
    expect(unguarded(mutated)).toHaveLength(3);
  });
});
