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
} from '../project.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

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
      url: 'https://thing.example',
      commitEndpoint: '/version.json',
      smoke: 'apps/ui/smoke.sh',
    },
  },
});

describe('the committed project.json', () => {
  it("names smoke scripts that exist, and keeps them out of their app's build inputs", () => {
    const project = loadProject();
    for (const [name, app] of deployed(project)) {
      if (!app.smoke) continue;
      expect(readFileSync(join(REPO_ROOT, app.smoke), 'utf8'), app.smoke).toMatch(/^#!\/usr\/bin\/env bash/);
      // A change to the checks is not a change to the build.
      expect(buildPathspecs(project, name), name).toContain(`:(exclude)${app.smoke}`);
    }
  });

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

  it('requires a deployed app to say where it answers and how it reports its commit', () => {
    const noUrl = minimal();
    delete noUrl.apps.ui!.url;
    expect(() => validate(noUrl)).toThrow(/apps\.ui\.url/);
    const withPath = minimal();
    withPath.apps.ui!.url = 'https://thing.example/app';
    expect(() => validate(withPath)).toThrow(/https origin with no path/);
    const plain = minimal();
    plain.apps.ui!.url = 'http://thing.example';
    expect(() => validate(plain)).toThrow(/apps\.ui\.url/);
    const relative = minimal();
    relative.apps.ui!.commitEndpoint = 'version.json';
    expect(() => validate(relative)).toThrow(/apps\.ui\.commitEndpoint/);
  });

  it('refuses deployment fields on an app that is not deployed', () => {
    const stray = minimal();
    stray.apps.svc!.url = 'https://svc.example';
    expect(() => validate(stray)).toThrow(/without a vercelProject/);
  });

  it("keeps an app's smoke script inside that app, however the path is spelled", () => {
    for (const smoke of [
      'scripts/evil.sh',
      'apps/ui/../../etc/passwd',
      'apps/ui/../other/smoke.sh',
      'apps/ui/./smoke.sh',
      'apps/ui',
      '/apps/ui/smoke.sh',
      'apps/uix/smoke.sh',
    ]) {
      const outside = minimal();
      outside.apps.ui!.smoke = smoke;
      expect(() => validate(outside), smoke).toThrow(/apps\.ui\.smoke/);
    }
    const nested = minimal();
    nested.apps.ui!.smoke = 'apps/ui/checks/smoke.sh';
    expect(() => validate(nested)).not.toThrow();
  });

  it('refuses an app path that climbs out of the repository', () => {
    for (const path of ['../elsewhere', 'apps/../..', 'apps/./svc']) {
      const climbing = minimal();
      climbing.apps.svc!.path = path;
      expect(() => validate(climbing), path).toThrow(/apps\.svc\.path/);
    }
  });

  it('refuses a verify list that is not a list of commands', () => {
    for (const verify of ['npm test', [], [''], ['  '], [42]]) {
      const bad = minimal();
      (bad.apps.svc as { verify: unknown }).verify = verify;
      if (Array.isArray(verify) && verify.length === 0) continue; // an empty list is allowed: nothing to run
      expect(() => validate(bad), JSON.stringify(verify)).toThrow(/apps\.svc\.verify/);
    }
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

  it('covers everything inside every declared app', () => {
    // The stop hook used to watch a hard-coded `data/`, which had moved inside
    // an app in #126, so data-only edits stopped triggering it silently. Every
    // app's whole directory is covered now, whatever the apps are (#173).
    const project = loadProject();
    const covered = verifiedPaths(project);
    for (const [name, app] of apps(project)) {
      expect(covered.some((p) => `${app.path}/data/anything.json`.startsWith(`${p}/`)), name).toBe(true);
    }
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
      'scripts/smoke.mjs',
      '.github/workflows/smoke.yml',
      '.claude/hooks/verify-on-stop.mjs',
      '.claude/hooks/format-edited.mjs',
      '.github/workflows/verify.yml',
      '.github/workflows/telegram-notify.yml',
    ];
    const project = loadProject();
    const names = [
      project.name,
      project.vercel.team,
      ...apps(project).flatMap(([, app]) => [app.path, app.vercelProject, app.url].filter(Boolean)),
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
