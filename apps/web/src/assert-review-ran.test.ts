import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  UNREADABLE,
  readExecution,
  readFlag,
  reviewVerdict,
} from '../../../scripts/assert-review-ran.mjs';

const finished = (extra: Record<string, unknown> = {}) => [
  { type: 'system', subtype: 'init' },
  { type: 'result', subtype: 'success', is_error: false, num_turns: 11, ...extra },
];

// The stream-json shapes the action's execution log is made of. #113 turns on
// these: the result message says how the run ended, the message array says
// what the session put on the pull request, and the two disagreed.
const assistant = (...content: unknown[]) => ({
  type: 'assistant',
  message: { role: 'assistant', content },
});

const text = (value: string) => ({ type: 'text', text: value });

const call = (id: string, name: string) => ({ type: 'tool_use', id, name, input: {} });

const inlineComment = (id: string) => call(id, 'mcp__github_inline_comment__create_inline_comment');

const answered = (id: string, extra: Record<string, unknown> = {}) => ({
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, ...extra }] },
});

const errored = { type: 'result', subtype: 'error_during_execution', is_error: true, num_turns: 8 };

describe('reviewVerdict', () => {
  it('passes a session that reached a verdict', () => {
    expect(reviewVerdict({ conclusion: 'success', execution: finished() }).ok).toBe(true);
  });

  it('fails when there is no execution log at all', () => {
    // The workflow-validation skip: the action exits before starting a session
    // and leaves the job green. Run 34814234791 did exactly this — sixteen
    // seconds, success, no review — on a pull request that changed CI.
    const verdict = reviewVerdict({ kind: 'security', conclusion: '', execution: null });
    expect(verdict.ok).toBe(false);
    expect(verdict.headline).toContain('security');
    expect(verdict.detail).toContain('.github/workflows/');
  });

  it('fails a session that ended with is_error', () => {
    // Three of the twenty runs before this script existed did, and the job log
    // reads "No buffered inline comments" — nothing reached the pull request.
    const verdict = reviewVerdict({ execution: finished({ is_error: true }) });
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain('unreviewed');
  });

  it('tells a review that errored after posting from one that errored before', () => {
    // #113, run 34961716119. Both jobs ended with `is_error: true` after 8
    // turns and this check said both had posted nothing. The security review
    // had posted a completed checklist and `Verdict: this belongs on develop
    // as it stands.`; the code review's checklist stopped at `[ ] Get diff`.
    // Same result message, different fact, and the wrong one cost a re-run of
    // a review that already existed.
    const security = reviewVerdict({
      kind: 'security',
      execution: [
        { type: 'system', subtype: 'init' },
        assistant(text('Let me read the rubric.'), call('toolu_1', 'Read')),
        answered('toolu_1'),
        assistant(
          text(
            'Every action is pinned by SHA and the job holds no more token than it uses.\n\nVerdict: this belongs on develop as it stands.',
          ),
        ),
        errored,
      ],
    });

    const code = reviewVerdict({
      kind: 'code',
      execution: [
        { type: 'system', subtype: 'init' },
        assistant(text('Let me read the rubric before I reach a verdict.'), call('toolu_1', 'Read')),
        answered('toolu_1'),
        errored,
      ],
    });

    // The job still fails either way — the run did fail.
    expect(security.ok).toBe(false);
    expect(code.ok).toBe(false);

    // What it must not do is assert something it did not check.
    expect(`${security.headline} ${security.detail}`).not.toContain('posted nothing');
    expect(security.detail).toContain('tracking comment');
    expect(security.headline).not.toBe(code.headline);
    expect(code.headline).toContain('posted nothing');
  });

  it('keeps the unposted message word for word', () => {
    // The case the log does establish stays exactly as it was: nothing in the
    // message array reached the pull request, so "posted nothing" is now an
    // observation rather than an inference, and reads the same.
    const verdict = reviewVerdict({
      execution: [assistant(text('Reading the rubric.'), call('toolu_1', 'Read')), answered('toolu_1'), errored],
    });
    expect(verdict.headline).toBe('The code review errored and posted nothing');
    expect(verdict.detail).toBe(
      'The session ended with `is_error: true` after 8 turns. This is a failure of the run, not a finding about the change — treat the pull request as unreviewed rather than as clean.',
    );
  });

  it('counts inline comments as a review even when no final message was written', () => {
    // A session cut off after commenting on the diff but before summing up:
    // the findings are on the lines, and telling anyone the pull request is
    // unreviewed is wrong in the same way.
    const verdict = reviewVerdict({
      execution: [
        assistant(text('Two things worth flagging.'), inlineComment('toolu_1'), inlineComment('toolu_2')),
        answered('toolu_1'),
        answered('toolu_2'),
        errored,
      ],
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain('2 inline comments');
    expect(verdict.detail).not.toContain('posted nothing');
  });

  it('does not count an inline comment the call failed to post', () => {
    // "It was called" is not "it worked" — the repository's own recurring
    // defect, applied to this check. A rejected call put nothing on the diff,
    // so the honest answer is the unchanged one.
    const verdict = reviewVerdict({
      execution: [
        assistant(text('Flagging this line.'), inlineComment('toolu_1')),
        answered('toolu_1', { is_error: true, content: 'line not part of the diff' }),
        errored,
      ],
    });
    expect(verdict.headline).toContain('posted nothing');
  });

  it('does not read narration about reaching a verdict as a verdict', () => {
    // The evidence has to be the verdict itself. A session that says it is
    // about to form one and then dies produced nothing.
    const verdict = reviewVerdict({
      execution: [assistant(text('Now let me get the diff so I can reach a verdict on it.')), errored],
    });
    expect(verdict.headline).toContain('posted nothing');
  });

  it('never quotes the posted review back either', () => {
    // Same reason as below: the log carries tool output, and this job holds
    // the Claude OAuth token and the Grafana credentials. What gets printed
    // is a count and a flag, never the text they were read from.
    const secret = 'sk-ant-oat-notarealtoken';
    const verdict = reviewVerdict({
      execution: [assistant(text(`Verdict: I would merge this. Logs showed ${secret}.`)), errored],
    });
    expect(`${verdict.headline} ${verdict.detail}`).not.toContain(secret);
    expect(`${verdict.headline} ${verdict.detail}`).not.toContain('posted nothing');
  });

  it('fails a log that never reached a result', () => {
    const verdict = reviewVerdict({ execution: [{ type: 'system', subtype: 'init' }] });
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain('cut off');
  });

  it('names the workflow rule only when a workflow file actually changed', () => {
    // #100: the security review on #98 produced no execution log, and this
    // check sent the reader off to diff a workflow file that pull request
    // never touched. The scope job knows the answer; it is passed in.
    const blamed = reviewVerdict({ execution: null, workflowChanged: true });
    expect(blamed.ok).toBe(false);
    expect(blamed.detail).toContain('byte-identical');
    // Stated as fact, not as "the usual cause" — the job checked.
    expect(blamed.detail).not.toContain('usual cause');
  });

  it('rules the workflow rule out when no workflow file changed', () => {
    const verdict = reviewVerdict({ execution: null, workflowChanged: false });
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).not.toContain('byte-identical');
    expect(verdict.detail).toContain('job log');
  });

  it('hedges only when the scope job could not say', () => {
    // A scope job that died leaves the output empty. Unknown must read as
    // unknown: naming a cause nobody established is the defect being fixed.
    const verdict = reviewVerdict({ execution: null, workflowChanged: null });
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain('usual');
    expect(verdict.detail).toContain('byte-identical');
  });

  it('says something different in each of the three cases', () => {
    const details = [true, false, null].map(
      (workflowChanged) => reviewVerdict({ execution: null, workflowChanged }).detail,
    );
    expect(new Set(details).size).toBe(3);
  });

  it('fails when the action itself did not call it a success', () => {
    const verdict = reviewVerdict({ conclusion: 'failure', execution: finished() });
    expect(verdict.ok).toBe(false);
    expect(verdict.headline).toContain('failure');
  });

  it('never leaks the execution log into what it prints', () => {
    // The log carries tool output, and this job's environment holds the Claude
    // OAuth token and the Grafana credentials.
    const secret = 'sk-ant-oat-notarealtoken';
    const verdict = reviewVerdict({
      execution: finished({ is_error: true, result: `failed while reading ${secret}` }),
    });
    expect(`${verdict.headline} ${verdict.detail}`).not.toContain(secret);
  });

  it('defaults to failing rather than to passing', () => {
    // Called with nothing at all — no log, no conclusion — it must not report
    // that a review happened.
    expect(reviewVerdict().ok).toBe(false);
  });
});

describe('readFlag', () => {
  it('reads a workflow output back as true, false or unknown', () => {
    expect(readFlag('true')).toBe(true);
    expect(readFlag('false')).toBe(false);
  });

  it('does not read a missing output as false', () => {
    // A job that did not run leaves its outputs empty, and `false` here would
    // make this check state that no workflow file changed on the strength of
    // a job that never looked.
    for (const missing of [undefined, '', 'TRUE', 'yes', 'null']) {
      expect(readFlag(missing)).toBeNull();
    }
  });
});

let dir = '';

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});

describe('readExecution', () => {
  it('returns null for a path that is empty or missing', () => {
    expect(readExecution('')).toBeNull();
    expect(readExecution('/no/such/claude-execution-output.json')).toBeNull();
  });

  it('separates a log that will not parse from a log that is not there', () => {
    dir = mkdtempSync(join(tmpdir(), 'review-'));
    const path = join(dir, 'claude-execution-output.json');
    writeFileSync(path, 'Exiting due to workflow validation skip');

    // Both fail the job, but not for the same reason, and the reader is sent
    // to a different place by each.
    expect(readExecution(path)).toBe(UNREADABLE);

    const unreadable = reviewVerdict({ execution: UNREADABLE });
    const absent = reviewVerdict({ execution: null });
    expect(unreadable.ok).toBe(false);
    expect(absent.ok).toBe(false);
    expect(unreadable.headline).not.toBe(absent.headline);
    // The absent case blames the workflow-file rule. The unparseable one must
    // not, because that is a different failure with a different fix.
    expect(unreadable.detail).not.toMatch(/byte-identical/);
    expect(absent.detail).toMatch(/byte-identical/);
  });
});
