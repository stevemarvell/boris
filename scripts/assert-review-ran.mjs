// Fail the review job when no review was produced, and say which way it
// failed.
//
// This exists because the review job's green tick has twice meant nothing.
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
//    pull request.
//
// Neither can be fixed from here: the first is the action's own rule and the
// second is a session failing. What can be fixed is the silence. A reviewer
// that produced nothing is not a reviewer that found nothing, and this
// repository has four shipped defects whose common shape is a control that
// ran, reported success, and did not do its job. This one says so.
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
 */
export function reviewVerdict({ kind = 'code', conclusion = '', execution = null } = {}) {
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
      detail:
        'The action produced no execution log, so no session started. The usual cause is that this pull request changes a file under `.github/workflows/`: `claude-code-action` requires the workflow to be byte-identical to the copy on the default branch and exits early otherwise. A pull request that changes CI is the one class of change this reviewer cannot review — review it by hand, and re-read it on the pull request after this one.',
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
    return {
      ok: false,
      headline: `The ${kind} review errored and posted nothing`,
      detail: `The session ended with \`is_error: true\` after ${result.num_turns ?? 'an unknown number of'} turns. This is a failure of the run, not a finding about the change — treat the pull request as unreviewed rather than as clean.`,
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
 * A log that exists but does not parse. Distinct from `null`, which means the
 * action wrote no log at all.
 */
export const UNREADABLE = Symbol('unreadable execution log');

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
