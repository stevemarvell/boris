// Decide which reviews a pull request is worth spending a session on.
//
// A review session on this repository's pull requests costs between $0.83 and
// $1.36 (measured from the `total_cost_usd` in the execution logs of runs
// 34875160558 and 34874594954), so running two of them on a typo is real
// money. But the way a path filter fails here is already on the record:
// railway.json's watchPatterns named `apps/api/**` and omitted `manual/api/**`,
// so a change to the manual deployed nothing and said nothing. An allow-list
// of "security-sensitive paths" would fail the same way and be just as quiet —
// a hardcoded credential can land in any file in the repository, and no
// allow-list predicts which.
//
// So this is a deny-list of one narrow category, and the category is chosen
// because the claim "this cannot move the line docs/data-governance.md draws"
// is structurally true of it rather than merely plausible:
//
//   Markdown is rendered by scripts/markdown.mjs, which HTML-escapes every
//   text node and attribute and drops any link whose scheme is not http(s),
//   mailto, a fragment, or a relative path. A .md file therefore cannot put
//   script on the docs site, and it reaches no other deployment.
//
// Three exceptions, each a file that is Markdown but is not only prose:
//
//   - docs/data-governance.md is where the security posture is written down.
//     A pull request that widens what it permits is a security change even
//     though not a line of code moved, so it gets the security review (and no
//     code review — there is no code in it).
//   - .claude/**  holds the rubrics these reviewers read. A change that guts
//     security-checker.md would otherwise skip its own review.
//   - .github/**  is CI. Nothing there is ever "just prose".
//
// Everything else that is not Markdown gets both reviews. Unknown input — an
// empty list, a failed API call — gets both reviews too: the failure mode this
// guards against is silence, so it fails towards spending money rather than
// towards saying nothing.
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const GOVERNANCE = 'docs/data-governance.md';

/**
 * True when a path is prose that no deployment can execute. Deliberately
 * narrow: see the three exceptions in this file's header.
 */
export function isProse(path) {
  const clean = String(path).trim().replace(/^\.\//, '').toLowerCase();
  if (!clean.endsWith('.md')) return false;
  if (clean.startsWith('.claude/') || clean.startsWith('.github/')) return false;
  return true;
}

/**
 * Which reviews to run, given the paths a pull request changes.
 *
 * Returns `code` and `security` booleans and a `why` line for the log — the
 * decision is only useful if the run that acted on it says what it decided.
 */
export function reviewScope(paths) {
  const files = [...paths].map((path) => String(path).trim()).filter(Boolean);

  if (files.length === 0) {
    return {
      code: true,
      security: true,
      why: 'No file list was available, so both reviews run. A scope step that cannot read the diff must not be the reason a change goes unreviewed.',
    };
  }

  const code = files.filter((path) => !isProse(path));
  const governance = files.filter((path) => path.replace(/^\.\//, '') === GOVERNANCE);

  if (code.length > 0) {
    return {
      code: true,
      security: true,
      why: `${code.length} of ${files.length} changed files are not prose (${code.slice(0, 5).join(', ')}${code.length > 5 ? ', …' : ''}), so both reviews run.`,
    };
  }

  if (governance.length > 0) {
    return {
      code: false,
      security: true,
      why: `Every changed file is Markdown, but ${GOVERNANCE} is among them — that file is the security posture, so the security review runs and the code review does not.`,
    };
  }

  return {
    code: false,
    security: false,
    why: `All ${files.length} changed files are Markdown outside .claude/ and .github/. scripts/markdown.mjs escapes HTML and refuses unsafe URL schemes, so none of this reaches a deployment as anything but text. Both reviews skipped.`,
  };
}

/** Read the whole of stdin, so the caller can pipe `gh api ... --jq` into us. */
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const scope = reviewScope((await readStdin()).split('\n'));
  const output = process.env['GITHUB_OUTPUT'];
  if (output) {
    appendFileSync(output, `code=${scope.code}\nsecurity=${scope.security}\n`);
  }
  console.log(`code review: ${scope.code}`);
  console.log(`security review: ${scope.security}`);
  console.log(scope.why);
}
