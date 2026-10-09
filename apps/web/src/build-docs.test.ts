import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDocs, indexPage, MARKDOWN_PAGES } from '../scripts/build-docs.mjs';

// A stand-in repository, so a test never depends on what docs/ happens to say
// today — only on what the build does with it.
let root = '';
let out = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'docs-root-'));
  out = join(mkdtempSync(join(tmpdir(), 'docs-out-')), 'docs');

  mkdirSync(join(root, 'docs'), { recursive: true });

  // A name distinct from this repository's own, so a test proving the build
  // reads it dynamically cannot pass by accident the way a hardcoded name
  // would.
  writeFileSync(join(root, 'project.json'), JSON.stringify({ name: 'stand-in-app' }));
  writeFileSync(join(root, 'docs', 'adoption.md'), '# Stages\n\nA **step**.\n\n- [ ] a gap\n');
  writeFileSync(join(root, 'docs', 'data-governance.md'), '# Governance\n\nInvented *data*.\n');
  writeFileSync(join(root, 'docs', 'sops.md'), '# Procedures\n\nBounded `loops`.\n');
  writeFileSync(join(root, 'index.html'), '<h1>Hello, world</h1>\n');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(out, { recursive: true, force: true });
});

const build = (env: Record<string, string | undefined> = {}) => buildDocs({ root, out, env });
const read = (name: string) => readFileSync(join(out, name), 'utf8');

describe('buildDocs', () => {
  it('renders every Markdown page', () => {
    const result = build();

    expect(result.written).toEqual(
      expect.arrayContaining([
        'adoption.html',
        'data-governance.html',
        'sops.html',
        'index.html',
        'step-0.html',
      ]),
    );
    expect(read('adoption.html')).toContain('<strong>step</strong>');
    expect(read('adoption.html')).toContain('<input type="checkbox" disabled> a gap');
    expect(read('data-governance.html')).toContain('<em>data</em>');
    expect(read('sops.html')).toContain('<code>loops</code>');
  });

  it("publishes the build's commit for smoke's web freshness gate", () => {
    build({ VERCEL_GIT_COMMIT_SHA: 'abc123' });
    expect(JSON.parse(read('version.json'))).toEqual({ commit: 'abc123' });
  });

  it('publishes an empty commit outside Vercel rather than a stale one', () => {
    build({});
    expect(JSON.parse(read('version.json'))).toEqual({ commit: '' });
  });

  it('titles each page from its own first heading', () => {
    build();
    expect(read('adoption.html')).toContain('<title>Stages</title>');
    expect(read('data-governance.html')).toContain('<title>Governance</title>');
    expect(read('sops.html')).toContain('<title>Procedures</title>');
    expect(read('index.html')).toContain('>Stages</a>');
    expect(read('index.html')).toContain('>Governance</a>');
    expect(read('index.html')).toContain('>Procedures</a>');
  });

  it("titles the site from project.json's name, not a hardcoded one", () => {
    // stand-in-app is this fixture's name, not this repository's own — so
    // this would fail if the build ever went back to a hardcoded name.
    build();
    expect(read('index.html')).toContain('<h1>stand-in-app docs</h1>');
    expect(read('adoption.html')).toContain('<a href="./">stand-in-app docs</a>');
  });

  it('lists the documents in the order the build script declares them', () => {
    // The index is the way in, so the order it shows is a choice rather than
    // whatever the filesystem returns.
    build();
    const index = read('index.html');
    expect(index.indexOf('adoption.html')).toBeLessThan(index.indexOf('data-governance.html'));
    expect(index.indexOf('data-governance.html')).toBeLessThan(index.indexOf('sops.html'));
  });

  it('publishes the step-0 page exactly as it was written', () => {
    // It is a record of what this project looked like at step 0, not a page to
    // restyle.
    build();
    expect(read('step-0.html')).toBe('<h1>Hello, world</h1>\n');
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
  it('lists every document', () => {
    const html = indexPage(
      [{ slug: 'adoption', title: 'Stages', blurb: 'the ladder' }],
      'stand-in-app',
    );
    expect(html).toContain('href="adoption.html"');
    expect(html).toContain('href="step-0.html"');
  });

  it('escapes what it puts into the page, including the project name', () => {
    const html = indexPage([{ slug: 'x', title: '<script>', blurb: 'a & b' }], '<b>app</b>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('a &amp; b');
    expect(html).toContain('&lt;b&gt;app&lt;/b&gt; docs');
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
