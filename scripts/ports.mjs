// Derive e2e ports from the worktree so parallel checkouts do not collide.
// Explicit E2E_API_PORT / E2E_WEB_PORT always win.
//
// The offset comes from this file's own location, not process.cwd(): Playwright
// resolves its config with cwd = apps/web, which is the same string in every
// worktree, so a cwd-based hash gave every checkout identical ports.
import { createHash } from 'node:crypto';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKTREE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export function ports(root = WORKTREE_ROOT) {
  const envApi = Number(process.env['E2E_API_PORT']);
  const envWeb = Number(process.env['E2E_WEB_PORT']);
  if (envApi && envWeb) return { api: envApi, web: envWeb };

  // 0-199, so the two ranges below stay disjoint.
  const offset = parseInt(createHash('sha1').update(basename(root)).digest('hex').slice(0, 8), 16) % 200;
  return { api: envApi || 8200 + offset, web: envWeb || 8600 + offset };
}
