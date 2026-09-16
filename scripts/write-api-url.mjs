// Map an explicit VITE_API_URL through to Vite, or fall back to the committed
// one, before a build.
//
// The API and the web app are two independent Vercel projects (#126), and
// nothing pairs their preview deployments: no integration syncs one
// project's URL into the other's build the way Railway's did for API_URL.
// So every build here -- production and every pull request preview alike --
// points at the one production API. That is a deliberate choice, not a gap:
// docs/data-governance.md records that every preview serves the same
// invented tree as production, so a preview frontend calling the production
// API shows the same data a paired preview API would have.
//
// Vercel does give every deployment a predictable branch alias --
// family-tree-api-git-<branch>-stevemarvell-team.vercel.app, confirmed live
// against the family-tree-api project -- and reconstructing that string here
// was the alternative. Rejected for the build itself: it would need this
// script to reimplement Vercel's branch-name slugify (lowercase,
// non-alphanumeric runs to a single hyphen, truncated past some length) from
// a community write-up rather than a guaranteed contract, to buy a preview
// that -- per the paragraph above -- would show the same data anyway. It is
// still the right answer for a person or an agent who wants a *specific*
// pull request's own API deployment on purpose (to verify a change to
// apps/api itself): find or construct that URL directly rather than reading
// it out of a web build. See the `deployment` skill.
//
// Precedence: an explicit VITE_API_URL (the e2e suite sets one, so it can
// point at the uvicorn instance it started) wins; otherwise the committed
// apps/web/.env.production stands as the fallback, unedited.
//
// The one value this script actually handles -- VITE_API_URL -- can still
// come from Vercel's environment rather than from a user directly, but it is
// validated before being written into the file that configures the shipped
// bundle. This project's failures have consistently been quiet
// misconfiguration (Railpack ignoring railway.json, Vercel building the
// wrong directory, CORS refusing 127.0.0.1) rather than a crash -- so a
// value that can't possibly be right fails the build loudly instead of
// producing a bundle that silently points at a bad host. In particular, the
// URL parser strips tab and newline characters out of its input rather than
// rejecting them, so a value with an embedded newline can parse
// "successfully" into something other than what was intended -- control
// characters are therefore checked for directly, before anything is handed
// to `new URL()`.
import { rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const WEB_DIR = join(dirname(dirname(fileURLToPath(import.meta.url))), 'apps', 'web');

/**
 * Throws with a build-failing, human-readable message unless `url` is an
 * absolute http/https URL with a host and no control characters.
 *
 * `context` names where the value came from, so the failure points at the
 * offending environment variable rather than just "a URL was bad".
 */
export function assertValidApiUrl(url, context) {
  // eslint-disable-next-line no-control-regex -- deliberately matching control characters
  if (/[\x00-\x1f\x7f]/.test(url)) {
    throw new Error(
      `${context} contains control characters (e.g. a newline) and cannot be used as a build-time API URL: ${JSON.stringify(url)}`,
    );
  }
  if (url !== url.trim()) {
    throw new Error(`${context} has leading or trailing whitespace: ${JSON.stringify(url)}`);
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${context} is not a well-formed absolute URL: ${JSON.stringify(url)}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${context} must be an http or https URL, got ${JSON.stringify(url)}`);
  }
  if (!parsed.hostname) {
    throw new Error(`${context} has no host: ${JSON.stringify(url)}`);
  }
}

/**
 * Decides which API URL this build belongs to, without touching the disk.
 *
 * Split out from writeApiUrl so that scripts/build-docs.mjs can ask the same
 * question -- the docs index links to the API's own manual, and it should
 * name the same API the bundle itself will call. One rule, two callers.
 *
 * The 'fallback' case carries no url: the answer then lives in the committed
 * .env.production, which only a caller that reads files can see.
 */
export function chooseApiUrl(env = process.env) {
  const explicitUrl = env['VITE_API_URL'];
  if (explicitUrl) {
    assertValidApiUrl(explicitUrl, 'VITE_API_URL');
    return { action: 'explicit', url: explicitUrl };
  }

  return { action: 'fallback' };
}

/**
 * Returns what it did, so this is testable without reading the filesystem.
 *
 * The generated file is always removed first. It is gitignored and survives
 * between builds, so leaving a previous run's value in place would silently
 * override the fallback -- Vite loads .env.production.local ahead of
 * .env.production.
 */
export function writeApiUrl(env = process.env, webDir = WEB_DIR) {
  const target = join(webDir, '.env.production.local');
  rmSync(target, { force: true });

  const chosen = chooseApiUrl(env);
  // An explicit VITE_API_URL is already in the environment Vite will read, and
  // the fallback is the committed file; neither needs a generated one.
  return chosen;
}

const MESSAGES = {
  explicit: 'VITE_API_URL is set explicitly; leaving it alone',
  fallback: 'no explicit VITE_API_URL; falling back to the committed .env.production',
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { action, url } = writeApiUrl();
  console.log(url ? `${MESSAGES[action]}: ${url}` : MESSAGES[action]);
}
