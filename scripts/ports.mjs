// Derive e2e ports from the worktree directory so parallel checkouts do not
// collide. Explicit E2E_API_PORT / E2E_WEB_PORT always win.
import { createHash } from 'node:crypto';
import { basename } from 'node:path';

export function ports(cwd = process.cwd()) {
  const envApi = Number(process.env['E2E_API_PORT']);
  const envWeb = Number(process.env['E2E_WEB_PORT']);
  if (envApi && envWeb) return { api: envApi, web: envWeb };

  // 0-199, so the two ranges below stay disjoint.
  const offset = parseInt(createHash('sha1').update(basename(cwd)).digest('hex').slice(0, 8), 16) % 200;
  return { api: envApi || 8200 + offset, web: envWeb || 8600 + offset };
}
