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
import { rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const WEB_DIR = join(dirname(dirname(fileURLToPath(import.meta.url))), 'apps', 'web');

/**
 * Returns what it did, so this is testable without reading the filesystem.
 *
 * The generated file is always removed first. It is gitignored and survives
 * between builds, so leaving a previous run's value in place would silently
 * override the fallback — Vite loads .env.production.local ahead of
 * .env.production.
 */
/**
 * Railway names a PR environment's domain after the service, the repository,
 * and the pull request number. Overridable, because it is a convention rather
 * than a contract — if Railway changes it, set RAILWAY_PR_API_TEMPLATE.
 */
export function prApiUrl(pullRequest, template = 'https://api-boris-pr-{pr}.up.railway.app') {
  return template.replace('{pr}', String(pullRequest));
}

export function writeApiUrl(env = process.env, webDir = WEB_DIR) {
  const target = join(webDir, '.env.production.local');
  rmSync(target, { force: true });

  if (env['VITE_API_URL']) return { action: 'explicit', url: env['VITE_API_URL'] };

  const pullRequest = env['VERCEL_GIT_PULL_REQUEST_ID'];
  if (pullRequest) {
    const url = prApiUrl(pullRequest, env['RAILWAY_PR_API_TEMPLATE']);
    writeFileSync(target, `VITE_API_URL=${url}
`, 'utf8');
    return { action: 'pr', url };
  }

  const apiUrl = env['API_URL'];
  if (apiUrl) {
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
