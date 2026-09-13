import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { apiBaseUrl, buildDocs, indexPage, MARKDOWN_PAGES } from '../../../scripts/build-docs.mjs';

// A stand-in repository, so a test never depends on what docs/ happens to say
// today — only on what the build does with it.
let root = '';
let out = '';

const FALLBACK = 'https://api-production-53f7b.up.railway.app';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'docs-root-'));
  out = join(mkdtempSync(join(tmpdir(), 'docs-out-')), 'docs');

  mkdirSync(join(root, 'docs'), { recursive: true });
  mkdirSync(join(root, 'manual', 'web'), { recursive: true });
  mkdirSync(join(root, 'apps', 'web'), { recursive: true });

  writeFileSync(join(root, 'docs', 'adoption.md'), '# Stages\n\nA **step**.\n');
  writeFileSync(join(root, 'docs', 'BACKLOG.md'), '# Backlog\n\n- [ ] a gap\n');
  writeFileSync(join(root, 'index.html'), '<h1>Hello, world</h1>\n');
  writeFileSync(join(root, 'manual', 'web', 'index.html'), '<h1>Web manual</h1>\n');
  writeFileSync(join(root, 'manual', 'web', 'shot.jpg'), 'not really a jpeg');
  writeFileSync(join(root, 'apps', 'web', '.env.production'), `VITE_API_URL=${FALLBACK}\n`);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(out, { recursive: true, force: true });
});

const build = (env: Record<string, string | undefined> = {}) => buildDocs({ root, out, env });
const read = (name: string) => readFileSync(join(out, name), 'utf8');

describe('apiBaseUrl', () => {
  it('falls back to the committed .env.production', () => {
    expect(apiBaseUrl({}, root)).toBe(FALLBACK);
  });

  it('follows the build to a pull request environment', () => {
    // The docs link to the API's own manual; on a preview that has to be the
    // preview's API, for the same reason the bundle points there.
    expect(apiBaseUrl({ VERCEL_GIT_PULL_REQUEST_ID: '20' }, root)).toBe(
      'https://api-boris-pr-20.up.railway.app',
    );
  });

  it('prefers an explicit VITE_API_URL, trailing slash and all', () => {
    expect(apiBaseUrl({ VITE_API_URL: 'http://127.0.0.1:8254/' }, root)).toBe(
      'http://127.0.0.1:8254',
    );
  });

  it('refuses a malformed URL rather than building a broken link', () => {
    expect(() => apiBaseUrl({ API_URL: 'not a url' }, root)).toThrow(/well-formed/);
  });

  it('says so when the fallback file has no VITE_API_URL', () => {
    writeFileSync(join(root, 'apps', 'web', '.env.production'), '# nothing here\n');
    expect(() => apiBaseUrl({}, root)).toThrow(/does not set VITE_API_URL/);
  });
});

describe('buildDocs', () => {
  it('renders every Markdown page', () => {
    const result = build();

    expect(result.written).toEqual(
      expect.arrayContaining(['adoption.html', 'backlog.html', 'index.html', 'step-0.html']),
    );
    expect(read('adoption.html')).toContain('<strong>step</strong>');
    expect(read('backlog.html')).toContain('<input type="checkbox" disabled> a gap');
  });

  it('titles each page from its own first heading', () => {
    build();
    expect(read('adoption.html')).toContain('<title>Stages</title>');
    expect(read('backlog.html')).toContain('<title>Backlog</title>');
    expect(read('index.html')).toContain('>Stages</a>');
  });

  it('publishes the step-0 page exactly as it was written', () => {
    // It is a record of what this project looked like at step 0, not a page to
    // restyle.
    build();
    expect(read('step-0.html')).toBe('<h1>Hello, world</h1>\n');
  });

  it('copies the web manual whole, screenshots included', () => {
    build();
    expect(read(join('manual', 'web', 'index.html'))).toContain('Web manual');
    expect(existsSync(join(out, 'manual', 'web', 'shot.jpg'))).toBe(true);
  });

  it('points the index at the API that serves the API manual', () => {
    const result = build({ VERCEL_GIT_PULL_REQUEST_ID: '20' });
    expect(result.apiUrl).toBe('https://api-boris-pr-20.up.railway.app');
    expect(read('index.html')).toContain('href="https://api-boris-pr-20.up.railway.app/"');
  });

  it('does not copy the API manual into the Vercel bundle', () => {
    // It ships in the API image instead, so that it is always the manual for
    // the deployment the reader is querying.
    build();
    expect(existsSync(join(out, 'manual', 'api'))).toBe(false);
  });

  it('clears the output directory, so a removed page cannot linger', () => {
    build();
    writeFileSync(join(out, 'stale.html'), 'from an older build');
    build();
    expect(existsSync(join(out, 'stale.html'))).toBe(false);
  });

  it('builds into a directory that does not exist yet', () => {
    rmSync(out, { recursive: true, force: true });
    expect(() => build()).not.toThrow();
    expect(existsSync(join(out, 'index.html'))).toBe(true);
  });

  it('fails loudly when a source document is missing', () => {
    rmSync(join(root, 'docs', 'adoption.md'));
    expect(() => build()).toThrow();
  });
});

describe('indexPage', () => {
  it('lists every document, including the ones it does not host', () => {
    const html = indexPage('https://api.example', [
      { slug: 'adoption', title: 'Stages', blurb: 'the ladder' },
    ]);
    expect(html).toContain('href="adoption.html"');
    expect(html).toContain('href="manual/web/"');
    expect(html).toContain('href="https://api.example/"');
    expect(html).toContain('href="step-0.html"');
  });

  it('escapes what it puts into the page', () => {
    const html = indexPage('https://api.example', [
      { slug: 'x', title: '<script>', blurb: 'a & b' },
    ]);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('a &amp; b');
  });
});

describe('the pages this repository actually publishes', () => {
  it('names the real source files', () => {
    // A renamed doc should break here rather than at deploy time.
    const repo = join(__dirname, '..', '..', '..');
    for (const entry of MARKDOWN_PAGES) {
      expect(existsSync(join(repo, entry.source)), entry.source).toBe(true);
    }
  });
});
