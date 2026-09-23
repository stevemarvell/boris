import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

type Manifest = {
  workspaces?: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const read = (dir: string): Manifest => JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8')) as Manifest;
const declared = (m: Manifest) => ({ ...m.dependencies, ...m.devDependencies });

// The root declares the AI layer's own test tools (#173) at the same versions
// a workspace may also use, so npm installs one copy. Nothing else keeps the
// two declarations equal: bump one and npm quietly installs two, and
// verify:harness and the app's own checks run different versions of the same
// tool. Written against every workspace, not a named app, so it holds
// whatever the application is.
describe('shared tool versions', () => {
  it('match wherever the root and a workspace declare the same package', () => {
    const root = read('.');
    const rootDeps = declared(root);
    expect(root.workspaces?.length ?? 0).toBeGreaterThan(0);
    const mismatches: string[] = [];
    for (const workspace of root.workspaces ?? []) {
      for (const [name, version] of Object.entries(declared(read(workspace)))) {
        if (name in rootDeps && rootDeps[name] !== version) {
          mismatches.push(`${name}: root ${rootDeps[name]}, ${workspace} ${version}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('are declared by the root at all, so the AI layer does not borrow an app install', () => {
    const rootDeps = declared(read('.'));
    for (const tool of ['vitest', 'typescript', 'eslint', 'typescript-eslint', '@eslint/js', '@types/node']) {
      expect(rootDeps, tool).toHaveProperty(tool);
    }
  });
});
