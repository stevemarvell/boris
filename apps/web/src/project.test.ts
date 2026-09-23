import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  HARNESS_CODE,
  appFor,
  apps,
  buildPathspecs,
  cli,
  deployed,
  loadProject,
  validate,
  verifiedPaths,
  type Project,
} from '../../../scripts/project.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const minimal = (): Project => ({
  name: 'thing',
  vercel: { team: 't' },
  apps: {
    svc: { path: 'apps/svc', toolchain: 'python', reads: ['apps/svc'] },
    ui: {
      path: 'apps/ui',
      toolchain: 'node',
      reads: ['apps/ui', 'docs'],
      ignores: ['apps/ui/e2e', '**/*.test.ts'],
      vercelProject: 'thing-ui',
    },
  },
});

describe('the committed project.json', () => {
  it('is valid, and every declared app directory exists', () => {
    const project = loadProject();
    for (const [, app] of apps(project)) {
      const listed = execFileSync('git', ['ls-files', '--', app.path], { cwd: REPO_ROOT, encoding: 'utf8' });
      expect(listed.length, `${app.path} has tracked files`).toBeGreaterThan(0);
    }
  });

  it('deploys exactly the projects that have vercel.json ignore steps', () => {
    const project = loadProject();
    // Every deployed app has a vercel.json running the ignore step under its name…
    for (const [name, app] of deployed(project)) {
      const vercelJson = readFileSync(join(REPO_ROOT, app.path, 'vercel.json'), 'utf8');
      expect(vercelJson).toContain(`vercel-ignore.mjs ${name}`);
    }
    // …and every tracked vercel.json belongs to a deployed app of that name.
    const tracked = execFileSync('git', ['ls-files', '--', '*vercel.json'], { cwd: REPO_ROOT, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    const deployedPaths = new Map(deployed(project).map(([name, app]) => [`${app.path}/vercel.json`, name]));
    expect(tracked.sort()).toEqual([...deployedPaths.keys()].sort());
    for (const file of tracked) {
      const { ignoreCommand } = JSON.parse(readFileSync(join(REPO_ROOT, file), 'utf8')) as { ignoreCommand: string };
      expect(ignoreCommand.endsWith(` ${deployedPaths.get(file)}`), file).toBe(true);
    }
  });
});

describe('validate', () => {
  it('accepts the documented shape', () => {
    expect(validate(minimal()).name).toBe('thing');
  });

  it('names the field that is wrong', () => {
    const noTeam = { ...minimal(), vercel: {} };
    expect(() => validate(noTeam)).toThrow(/vercel\.team/);
    const badToolchain = minimal();
    (badToolchain.apps.svc as { toolchain: string }).toolchain = 'ruby';
    expect(() => validate(badToolchain)).toThrow(/apps\.svc\.toolchain/);
    const absolute = minimal();
    absolute.apps.svc!.path = '/etc';
    expect(() => validate(absolute)).toThrow(/apps\.svc\.path/);
  });

  it('refuses an empty Vercel project name', () => {
    const empty = minimal();
    empty.apps.ui!.vercelProject = '';
    expect(() => validate(empty)).toThrow(/apps.ui.vercelProject/);
  });

  it('refuses a project with no apps', () => {
    expect(() => validate({ ...minimal(), apps: {} })).toThrow(/at least one app/);
  });
});

describe('appFor', () => {
  it('finds the app holding a path, deepest first, and nothing outside every app', () => {
    const project = minimal();
    project.apps.nested = { path: 'apps/svc/plugin', toolchain: 'node', reads: ['apps/svc/plugin'] };
    expect(appFor(project, 'apps/svc/src/x.py')?.[0]).toBe('svc');
    expect(appFor(project, 'apps/svc/plugin/y.ts')?.[0]).toBe('nested');
    expect(appFor(project, 'apps\\svc\\src\\x.py')?.[0]).toBe('svc');
    expect(appFor(project, 'apps/svcx/z.py')).toBeNull();
    expect(appFor(project, 'scripts/a.mjs')).toBeNull();
  });
});

describe('buildPathspecs', () => {
  it("is the app's reads, the manifest and the ignore script, minus its ignores", () => {
    expect(buildPathspecs(minimal(), 'ui')).toEqual([
      'apps/ui',
      'docs',
      'project.json',
      'scripts/project.mjs',
      'scripts/vercel-ignore.mjs',
      ':(exclude)apps/ui/e2e',
      ':(exclude,glob)**/*.test.ts',
    ]);
  });

  it('is null for an app that is not declared', () => {
    expect(buildPathspecs(minimal(), 'nope')).toBeNull();
  });
});

describe('verifiedPaths', () => {
  it("covers every app and every read, plus the AI layer's own code", () => {
    const paths = verifiedPaths(minimal());
    for (const p of ['apps/svc', 'apps/ui', 'docs', ...HARNESS_CODE]) expect(paths).toContain(p);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('covers where the data lives now, which the old hard-coded list did not', () => {
    // The stop hook watched `data/` until #173; the tree moved to apps/api/data in #126.
    const covered = verifiedPaths(loadProject());
    expect(covered.some((p) => 'apps/api/data/family.json'.startsWith(`${p}/`))).toBe(true);
  });
});

describe('cli', () => {
  it('lists app paths, optionally for one toolchain', () => {
    expect(cli(['apps'], minimal())).toEqual(['apps/svc', 'apps/ui']);
    expect(cli(['apps', 'python'], minimal())).toEqual(['apps/svc']);
    expect(cli(['apps', 'node'], minimal())).toEqual(['apps/ui']);
  });

  it('refuses a subcommand it does not have', () => {
    expect(() => cli(['get', 'ui', 'url'], minimal())).toThrow(/usage/);
  });
});

describe('the AI layer names no application', () => {
  it('has no app path, project name or hostname in the code this issue moved behind the manifest', () => {
    const files = [
      'scripts/vercel-ignore.mjs',
      'scripts/vercel-prune.mjs',
      'scripts/bootstrap.mjs',
      '.claude/hooks/verify-on-stop.mjs',
      '.claude/hooks/format-edited.mjs',
      '.github/workflows/verify.yml',
      '.github/workflows/telegram-notify.yml',
    ];
    const project = loadProject();
    const names = [
      project.name,
      project.vercel.team,
      ...apps(project).flatMap(([, app]) => [app.path, app.vercelProject].filter(Boolean)),
      // No hostname either: deployment URLs are not in the manifest yet, so
      // this is the generic suffix every one of them shares.
      'vercel.app',
    ] as string[];
    for (const file of files) {
      const text = readFileSync(join(REPO_ROOT, file), 'utf8');
      const code = text
        .split('\n')
        .filter((line) => !/^\s*(\/\/|#|\*)/.test(line))
        .join('\n');
      for (const name of names) expect(code, `${file} names ${name}`).not.toContain(name);
    }
  });
});
