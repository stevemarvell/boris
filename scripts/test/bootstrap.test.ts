import { describe, expect, it } from 'vitest';
import { installCommands } from '../bootstrap.mjs';
import { loadProject, type Project } from '../project.mjs';

const engine = { commit: 'a'.repeat(40) };

describe('installCommands', () => {
  it('installs the root, every Python app and a browser when there is a node app', () => {
    const project: Project = {
      name: 'thing',
      apps: {
        back: { path: 'apps/back', toolchain: 'python', reads: ['apps/back'] },
        front: { path: 'apps/front', toolchain: 'node', reads: ['apps/front'] },
      },
    };
    expect(installCommands(project)).toEqual(['npm ci', 'uv sync --directory apps/back --frozen', 'npx playwright install chromium']);
  });

  it('installs no browser for a project with no node app, and no Python environment for one with no Python app', () => {
    const pythonOnly: Project = { name: 'thing', apps: { back: { path: 'apps/back', toolchain: 'python', reads: ['apps/back'] } } };
    expect(installCommands(pythonOnly)).toEqual(['npm ci', 'uv sync --directory apps/back --frozen']);
    const nodeOnly: Project = { name: 'thing', apps: { front: { path: 'apps/front', toolchain: 'node', reads: ['apps/front'] } } };
    expect(installCommands(nodeOnly)).toEqual(['npm ci', 'npx playwright install chromium']);
  });

  it('installs only the root for an engine-only product: no uv, no browser', () => {
    expect(installCommands({ name: 'thing', engine, apps: {} })).toEqual(['npm ci']);
  });

  it("covers the committed project.json's own apps", () => {
    const project = loadProject();
    const commands = installCommands(project);
    expect(commands[0]).toBe('npm ci');
    expect(commands.filter((c) => c.startsWith('uv sync')).length).toBe(Object.values(project.apps).filter((a) => a.toolchain === 'python').length);
  });
});
