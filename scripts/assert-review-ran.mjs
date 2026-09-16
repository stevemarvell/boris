// Fail the review job when no review was produced, and say which way it
// failed.
//
// This exists because the review job's green tick has meant nothing before,
// in three different ways.
//
// 1. `claude-code-action` refuses to run at all when the pull request changes
//    the workflow file, because the file has to be byte-identical to the copy
//    on the default branch. It logs "Exiting due to workflow validation skip",
//    posts nothing, and *leaves the job green*. Run 34814234791 is the
//    example: sixteen seconds, success, no review. So the one class of change
//    most worth a security review — a change to CI, its token permissions, or
//    an action pin — is the class this reviewer structurally cannot review.
// 2. The session ends with `is_error: true`. Three of the twenty runs before
//    this script existed did (34875160558, 34835904028, 34814480801), and the
//    job's own log says "No buffered inline comments" — nothing reached the
//    pull request. But sometimes plenty did: on run 34961716119 the security
//    review posted a full verdict and *then* errored, and this script called
//    that "posted nothing" too (#113). So the result message says how the run
//    ended and not what was posted, and the two are read separately —
//    `postedReview` below.
// 3. The action starts no session for its own reasons, on a pull request that
//    changes no workflow file. #98 did this: eighteen seconds, no execution
//    log, while the code review job on the same commit produced a full review
//    in 1m 20s. From inside the log this is indistinguishable from 1 — both
//    have no log at all — which is why the scope job's answer about the
//    changed files is passed in rather than guessed at here.
//
// None can be fixed from here: the first is the action's own rule and the
// other two are a session failing to start or to finish. What can be fixed is
// the silence. A reviewer that produced nothing is not a reviewer that found
// nothing, and this repository has four shipped defects whose common shape is
// a control that ran, reported success, and did not do its job. This one says
// so — and #100 is the reminder that saying the wrong thing is its own way of
// saying nothing.
import { readFileSync } from 'node:fs';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Did a review session actually run to a result?
 *
 * `execution` is the parsed contents of the action's execution log; `null`
 * when there is no file to parse — which is itself the loudest signal, since
 * it means no session started — or `UNREADABLE` when a file was written but
 * did not parse. Those two are kept apart on purpose: they fail the job the
 * same way but have different causes, and a check that names the wrong cause
 * sends whoever reads it to the wrong place.
 *
 * `workflowChanged` is the scope job's answer to "does this pull request
 * touch `.github/workflows/`", and `null` when the scope job could not say.
 * It exists because of #100: with no session and no log, this function used
 * to blame the workflow-file rule every time, including on #98, which changed
 * no workflow file. Three answers, three messages — the rule stated as fact
 * when it applies, ruled out when it does not, and offered as the likely
 * cause only when nobody knows.
 */
export function reviewVerdict({
  kind = 'code',
  conclusion = '',
  execution = null,
  workflowChanged = null,
} = {}) {
  const messages = Array.isArray(execution) ? execution : [];
  const result = messages.findLast?.((message) => message?.type === 'result') ?? null;

  if (execution === UNREADABLE) {
    return {
      ok: false,
      headline: `The ${kind} review left a log that could not be read`,
      detail:
        'The action wrote an execution log but it did not parse as JSON, so whether a review happened cannot be established from here. Treat the pull request as unreviewed and read the job log by hand.',
    };
  }

  if (execution === null) {
    return {
      ok: false,
      headline: `No ${kind} review ran on this pull request`,
      detail: `The action produced no execution log, so no session started. ${noSessionCause(workflowChanged)}`,
    };
  }

  if (result === null) {
    return {
      ok: false,
      headline: `The ${kind} review did not finish`,
      detail:
        'The execution log holds no result message, so the session was cut off rather than ending with a verdict.',
    };
  }

  if (result.is_error === true) {
    const posted = postedReview(messages);
    const turns = result.num_turns ?? 'an unknown number of';

    if (posted.inlineComments > 0 || posted.verdict) {
      return {
        ok: false,
        headline: `The ${kind} review errored after producing a review`,
        detail: `The session ended with \`is_error: true\` after ${turns} turns, but the log shows it had already produced a review: ${evidenceOf(posted)}. \`track_progress\` writes the session's output into the tracking comment as it goes and the action prepends its error to it, so that review is on the pull request now. Read it and judge whether it is complete before re-running — a re-run buys a second review of a change that already has one. The run still failed: what this cannot tell you is whether the session had more to say when it fell over.`,
      };
    }

    return {
      ok: false,
      headline: `The ${kind} review errored and posted nothing`,
      detail: `The session ended with \`is_error: true\` after ${turns} turns. This is a failure of the run, not a finding about the change — treat the pull request as unreviewed rather than as clean.`,
    };
  }

  if (conclusion && conclusion !== 'success') {
    return {
      ok: false,
      headline: `The ${kind} review reported \`${conclusion}\``,
      detail: 'The session reached a result but the action did not call it a success.',
    };
  }

  return {
    ok: true,
    headline: `The ${kind} review ran to a verdict`,
    detail: `${result.num_turns ?? 0} turns. The verdict is on the pull request, in the tracking comment.`,
  };
}

/**
 * What the log shows the session put on the pull request, as distinct from
 * how the session ended. The two are independent — #113: the security review
 * on #112 posted a completed checklist, five paragraphs and
 * `Verdict: this belongs on develop as it stands.`, and *then* ended with
 * `is_error: true`. Reading that error as "posted nothing" was an inference,
 * and it cost a re-run that produced the review already sitting on the pull
 * request. The code review on the same run errored for real, with a checklist
 * that stops at `[ ] Get diff` — same result message, different fact.
 *
 * Two observations, both from the message array rather than from the result:
 *
 * - a `create_inline_comment` call that did not come back an error. A finding
 *   is on a line of the diff. A call whose `tool_result` carries
 *   `is_error: true` posted nothing and is not counted — a control that is
 *   observed by "it was called" rather than "it worked" is the failure this
 *   repository keeps shipping.
 * - a final assistant message carrying the verdict line both rubrics ask for.
 *   `track_progress` mirrors the session's output into the tracking comment,
 *   so a session that wrote a verdict has a verdict on the pull request.
 *
 * The patterns below are the rubrics' own closing words, matched as
 * statements rather than as mentions, and only against the *last* non-empty
 * assistant text — mid-session narration about forming a verdict is not one.
 * Neither observation can prove a review is *complete*; both can show it is
 * not empty, which is the claim being corrected.
 */
const INLINE_COMMENT_TOOL = 'mcp__github_inline_comment__create_inline_comment';

const VERDICT_LINES = [
  // "Verdict: …", "**Verdict** — …": the rubric's word, used as a heading.
  /^[\s*_>#-]*verdict\b\s*[:—–-]/im,
  // The security rubric's closing line, and its negation, which contains it.
  /\bbelongs?\s+on\s+[`'"*]*develop\b/i,
  // The code rubric's: would you merge it.
  /\bwould(?:n't|\s+not)?\s+merge\b/i,
  // "An empty review is a real result and has to be stated" — this is it
  // being stated.
  /\bno\s+findings\b/i,
];

/**
 * The content blocks of a log message, whichever shape it arrives in. A
 * stream-json message wraps them in `message.content`; be tolerant of a flat
 * one rather than silently reading a review as absent.
 */
function contentBlocks(message) {
  const content = message?.message?.content ?? message?.content;
  return Array.isArray(content) ? content : [];
}

function postedReview(messages) {
  const failed = new Set();
  for (const message of messages) {
    for (const block of contentBlocks(message)) {
      if (block?.type === 'tool_result' && block.is_error === true && block.tool_use_id) {
        failed.add(block.tool_use_id);
      }
    }
  }

  let inlineComments = 0;
  let lastText = '';
  for (const message of messages) {
    if (message?.type !== 'assistant') continue;
    for (const block of contentBlocks(message)) {
      if (block?.type === 'tool_use' && block.name === INLINE_COMMENT_TOOL && !failed.has(block.id)) {
        inlineComments += 1;
      }
      if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        lastText = block.text;
      }
    }
  }

  return { inlineComments, verdict: VERDICT_LINES.some((pattern) => pattern.test(lastText)) };
}

/**
 * What was observed, as counts and flags only. Never the text: the log holds
 * tool output, and this job's environment holds two credentials.
 */
function evidenceOf({ inlineComments, verdict }) {
  const parts = [];
  if (inlineComments > 0) {
    parts.push(
      `${inlineComments} inline comment${inlineComments === 1 ? '' : 's'} it posted with \`create_inline_comment\``,
    );
  }
  if (verdict) parts.push('a final message carrying the verdict line the rubric asks for');
  return parts.join(', and ');
}

/**
 * Why no session started, given what the scope job knows about the changed
 * files. The three answers send the reader to three different places, which
 * is the whole point: the workflow rule is checkable, and stating it when it
 * does not hold costs somebody a diff of a file nobody touched.
 */
function noSessionCause(workflowChanged) {
  if (workflowChanged === true) {
    return 'This pull request changes a file under `.github/workflows/`, and `claude-code-action` requires the workflow to be byte-identical to the copy on the default branch: it exits early rather than running. A pull request that changes CI is the one class of change this reviewer cannot review — review it by hand, and re-read it on the pull request after this one.';
  }
  if (workflowChanged === false) {
    return 'This pull request changes no file under `.github/workflows/`, so the workflow-validation rule is not the cause and there is no workflow diff to go looking for. The action failed to start a session for its own reasons — the job log above is the only record of why. Treat the pull request as unreviewed and re-run the job.';
  }
  return 'The scope job did not report whether this pull request touches `.github/workflows/`, so the cause cannot be narrowed from here. The usual one is that rule: `claude-code-action` requires the workflow to be byte-identical to the copy on the default branch and exits early otherwise. If no workflow file changed, read the job log instead.';
}

/**
 * A log that exists but does not parse. Distinct from `null`, which means the
 * action wrote no log at all.
 */
export const UNREADABLE = Symbol('unreadable execution log');

/**
 * A workflow output read back as a tri-state: `true`, `false`, or `null` for
 * anything else. A job that died leaves its outputs empty, and empty must not
 * read as `false` — that is how a check ends up stating something it does not
 * know.
 */
export function readFlag(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

/**
 * Read and parse the action's execution log: `null` when there is no file,
 * `UNREADABLE` when there is one that will not parse.
 */
export function readExecution(path) {
  if (!path) return null;
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return UNREADABLE;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const kind = process.env['KIND'] || 'code';
  const verdict = reviewVerdict({
    kind,
    conclusion: process.env['CONCLUSION'] ?? '',
    execution: readExecution(process.env['EXECUTION_FILE'] ?? ''),
    workflowChanged: readFlag(process.env['WORKFLOW_CHANGED']),
  });

  const summary = process.env['GITHUB_STEP_SUMMARY'];
  // Never echo the execution log itself: it carries tool output, which on this
  // runner includes the environment of a job holding two credentials.
  const block = `### ${verdict.headline}\n\n${verdict.detail}\n`;
  if (summary) appendFileSync(summary, `${block}\n`);
  console.log(block);

  if (!verdict.ok) {
    console.log(`::warning title=${verdict.headline}::${verdict.detail}`);
    process.exit(1);
  }
}
