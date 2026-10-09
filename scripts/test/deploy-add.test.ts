import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addDeploy, ownerSteps, parseArgs, renderTemplate, withPlaceholders } from '../deploy/add.mjs';

describe('parseArgs', () => {
  it('parses the provider, --app and the optional flags', () => {
    expect(
      parseArgs(['vercel', '--app', 'api', '--team', 't', '--project', 'p', '--url', 'https://x.example', '--commit-endpoint', '/health']),
    ).toEqual({ provider: 'vercel', app: 'api', team: 't', project: 'p', url: 'https://x.example', commitEndpoint: '/health' });
  });

  it('requires a provider', () => {
    expect(() => parseArgs([])).toThrow(/usage/);
  });

  it('requires --app', () => {
    expect(() => parseArgs(['vercel'])).toThrow(/--app/);
  });

  it('refuses an unknown flag', () => {
    expect(() => parseArgs(['vercel', '--app', 'api', '--nope', 'x'])).toThrow(/unknown flag/);
  });

  it('refuses a flag with no value', () => {
    expect(() => parseArgs(['vercel', '--app'])).toThrow(/needs a value/);
  });
});

describe('withPlaceholders', () => {
  it('fills in whatever is missing with an obvious placeholder, never a guess', () => {
    expect(withPlaceholders({})).toEqual({
      team: '<team>',
      project: '<project>',
      url: 'https://<project>.vercel.app',
      commitEndpoint: '/health',
    });
  });

  it('keeps whatever is given', () => {
    expect(withPlaceholders({ team: 't', project: 'p', url: 'https://p.example', commitEndpoint: '/h' })).toEqual({
      team: 't',
      project: 'p',
      url: 'https://p.example',
      commitEndpoint: '/h',
    });
  });
});

describe('renderTemplate', () => {
  it('replaces every <key> with its value', () => {
    expect(renderTemplate('node x.mjs <app> for <team>/<project>', { app: 'api', team: 't', project: 'p' })).toBe('node x.mjs api for t/p');
  });
});

describe('ownerSteps', () => {
  it("names the app's Root Directory, and the VERCEL_TOKEN step", () => {
    const steps = ownerSteps({ app: 'api', team: 't', project: 'p' });
    expect(steps.some((s) => s.includes('apps/api'))).toBe(true);
    expect(steps.some((s) => s.includes('VERCEL_TOKEN'))).toBe(true);
    expect(steps.some((s) => s.includes('data-governance.md'))).toBe(true);
  });
});

describe('addDeploy', () => {
  let root: string;
  let manifestPath: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'deploy-add-'));
    mkdirSync(join(root, 'apps/api'), { recursive: true });
    manifestPath = join(root, 'project.json');
    writeFileSync(
      manifestPath,
      JSON.stringify({ name: 'thing', apps: { api: { path: 'apps/api', toolchain: 'python', reads: ['apps/api'] } } }, null, 2),
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('writes the deploy block, vercel.json and the deployment skill, filling in placeholders', () => {
    const { values } = addDeploy({
      provider: 'vercel',
      app: 'api',
      team: 't',
      project: 'thing-api',
      url: 'https://thing-api.example',
      commitEndpoint: '/health',
      root,
      manifestPath,
    });
    expect(values).toEqual({ team: 't', project: 'thing-api', url: 'https://thing-api.example', commitEndpoint: '/health' });

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(manifest.apps.api.deploy).toEqual({
      provider: 'vercel',
      team: 't',
      project: 'thing-api',
      url: 'https://thing-api.example',
      commitEndpoint: '/health',
    });

    const vercelJson = readFileSync(join(root, 'apps/api/vercel.json'), 'utf8');
    expect(vercelJson).toContain('vercel-ignore.mjs api');
    expect(vercelJson).not.toContain('<app>');

    const skill = readFileSync(join(root, 'apps/.claude/skills/deployment/SKILL.md'), 'utf8');
    expect(skill).toContain('thing-api');
    expect(skill).not.toContain('<project>');
    expect(skill).not.toContain('<app>');
  });

  it('fills in obvious placeholders, never a guess at the real values, when flags are left out', () => {
    const { values } = addDeploy({ provider: 'vercel', app: 'api', root, manifestPath });
    expect(values.team).toBe('<team>');
    expect(values.url).toBe('https://<project>.vercel.app');
  });

  it('is idempotent: running it again overwrites the block and the files', () => {
    addDeploy({ provider: 'vercel', app: 'api', team: 't', project: 'p1', url: 'https://p1.example', commitEndpoint: '/health', root, manifestPath });
    addDeploy({ provider: 'vercel', app: 'api', team: 't', project: 'p2', url: 'https://p2.example', commitEndpoint: '/health', root, manifestPath });
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(manifest.apps.api.deploy.project).toBe('p2');
    expect(readFileSync(join(root, 'apps/api/vercel.json'), 'utf8')).not.toContain('p1');
  });

  it('refuses an app project.json does not declare, before writing anything', () => {
    expect(() => addDeploy({ provider: 'vercel', app: 'nope', root, manifestPath })).toThrow(/no app named "nope"/);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(manifest.apps.api.deploy).toBeUndefined();
  });

  it('refuses a provider nothing registers, before writing anything', () => {
    expect(() => addDeploy({ provider: 'nope', app: 'api', root, manifestPath })).toThrow(/unknown deploy provider "nope"/);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(manifest.apps.api.deploy).toBeUndefined();
  });
});
