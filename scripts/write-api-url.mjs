// Map Railway's API_URL onto Vite's VITE_API_URL before a build.
//
// The Railway integration syncs the API service's own variables into Vercel,
// so API_URL is present at build time and always points at whichever Railway
// environment this deployment belongs to. Vite only exposes VITE_-prefixed
// variables to client code, hence the mapping.
//
// Precedence: an explicit VITE_API_URL (the e2e suite sets one) wins; then a
// Railway PR environment when Vercel is building a pull request preview; then
// API_URL; otherwise the committed .env.production stands as the fallback.
//
// The PR case exists because the Railway integration syncs the *production*
// environment's API_URL into Vercel, for previews as well as production. So
// without this, a preview frontend is built against production and shows
// production's data — which makes verifying a branch in a browser worthless,
// and quietly so.
//
// Every value this script reads comes from Vercel's or Railway's environment,
// not from a user directly, but it still gets validated before being written
// into the file that configures the shipped bundle. This project's failures
// have consistently been quiet misconfiguration (Railpack ignoring
// railway.json, Vercel building the wrong directory, CORS refusing
// 127.0.0.1) rather than a crash — so a value that can't possibly be right
// fails the build loudly instead of producing a bundle that silently points
// at a bad host. In particular, the URL parser strips tab and newline
// characters out of its input rather than rejecting them, so a value with an
// embedded newline can parse "successfully" into something other than what
// was intended — control characters are therefore checked for directly,
// before anything is handed to `new URL()`.
import { rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const WEB_DIR = join(dirname(dirname(fileURLToPath(import.meta.url))), 'apps', 'web');

/**
 * Railway names a PR environment's domain after the service, the repository,
 * and the pull request number. Overridable, because it is a convention rather
 * than a contract — if Railway changes it, set RAILWAY_PR_API_TEMPLATE.
 */
export function prApiUrl(pullRequest, template = 'https://api-boris-pr-{pr}.up.railway.app') {
  return template.replace('{pr}', String(pullRequest));
}

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
 * Throws unless `value` is a plain positive integer with no sign, decimal
 * point, or surrounding whitespace — the shape Vercel's
 * VERCEL_GIT_PULL_REQUEST_ID is documented to have. This runs before the
 * value reaches prApiUrl(), which otherwise interpolates it straight into a
 * hostname.
 */
export function assertValidPullRequestId(value, context) {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${context} is not a positive integer pull request id: ${JSON.stringify(value)}`);
  }
}

/**
 * Returns what it did, so this is testable without reading the filesystem.
 *
 * The generated file is always removed first. It is gitignored and survives
 * between builds, so leaving a previous run's value in place would silently
 * override the fallback — Vite loads .env.production.local ahead of
 * .env.production.
 */
export function writeApiUrl(env = process.env, webDir = WEB_DIR) {
  const target = join(webDir, '.env.production.local');
  rmSync(target, { force: true });

  const explicitUrl = env['VITE_API_URL'];
  if (explicitUrl) {
    assertValidApiUrl(explicitUrl, 'VITE_API_URL');
    return { action: 'explicit', url: explicitUrl };
  }

  const pullRequest = env['VERCEL_GIT_PULL_REQUEST_ID'];
  if (pullRequest) {
    assertValidPullRequestId(pullRequest, 'VERCEL_GIT_PULL_REQUEST_ID');
    const url = prApiUrl(pullRequest, env['RAILWAY_PR_API_TEMPLATE']);
    assertValidApiUrl(url, 'the pull request API URL');
    writeFileSync(target, `VITE_API_URL=${url}\n`, 'utf8');
    return { action: 'pr', url };
  }

  const apiUrl = env['API_URL'];
  if (apiUrl) {
    assertValidApiUrl(apiUrl, 'API_URL');
    writeFileSync(target, `VITE_API_URL=${apiUrl}\n`, 'utf8');
    return { action: 'mapped', url: apiUrl };
  }

  return { action: 'fallback' };
}

const MESSAGES = {
  explicit: 'VITE_API_URL is set explicitly; leaving it alone',
  mapped: "mapped Railway's API_URL onto VITE_API_URL",
  pr: 'pull request preview, pointing at its own Railway environment',
  fallback: 'no API_URL; falling back to the committed .env.production',
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { action, url } = writeApiUrl();
  console.log(url ? `${MESSAGES[action]}: ${url}` : MESSAGES[action]);
}
