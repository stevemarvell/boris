// Build the documentation site that Vercel serves alongside the web app.
//
// This exists because GitHub Pages is not available on a private repository
// without a paid plan, and the repository is going private. Everything Pages
// published — the step-0 page, the web manual, and the Markdown under docs/ —
// is rendered into apps/web/public/docs, which Vite copies verbatim into the
// bundle, so it lands at /docs on the Vercel deployment.
//
// The API's own manual is *not* here. It ships as part of the API's own
// Vercel build and is served by the API itself, at the root of its own
// deployment: it documents that service, and it calls that service from the
// browser without crossing an origin to do it.
//
// The output directory is generated and gitignored. It is deleted and rebuilt
// on every run, so a page removed from this script cannot linger in a build.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { escapeHtml, firstHeading, renderMarkdown } from './markdown.mjs';
import { chooseApiUrl } from './write-api-url.mjs';

export const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const DOCS_DIR = join(REPO_ROOT, 'apps', 'web', 'public', 'docs');

/** Where the API — and so its manual — lives for the build being made. */
export function apiBaseUrl(env = process.env, root = REPO_ROOT) {
  // The docs link to the API's own manual, and should name the same API the
  // bundle itself will call -- see write-api-url.mjs for why that is always
  // production, previews included.
  const chosen = chooseApiUrl(env);
  if (chosen.url) return chosen.url.replace(/\/+$/, '');

  // 'fallback' means the committed .env.production is the answer.
  const committed = readFileSync(join(root, 'apps', 'web', '.env.production'), 'utf8');
  const match = /^\s*VITE_API_URL\s*=\s*(\S+)\s*$/m.exec(committed);
  if (!match) throw new Error('apps/web/.env.production does not set VITE_API_URL');
  return match[1].replace(/\/+$/, '');
}

/** The Markdown documents, in the order the index lists them. */
export const MARKDOWN_PAGES = [
  {
    slug: 'adoption',
    source: join('docs', 'adoption.md'),
    blurb: 'The ladder this project is climbing, kept in its original wording.',
  },
  {
    slug: 'data-governance',
    source: join('docs', 'data-governance.md'),
    blurb: 'What the deployments expose, why that is deliberate, and what would change it.',
  },
  {
    slug: 'sops',
    source: join('docs', 'sops.md'),
    blurb: 'How agent work is run here: bounded loops, work that needs a person, and where a control is proven.',
  },
  {
    slug: 'extraction',
    source: join('docs', 'extraction.md'),
    blurb: 'What in this repository is reusable on another project, and what is a conclusion that must not be copied.',
  },
];

const STYLE = `
:root { color-scheme: light dark; --bg: #ffffff; --text: #16181d; --muted: #6d7278;
  --rule: rgba(0,0,0,0.13); --accent: #3880ff; --shade: #f4f5f8; }
@media (prefers-color-scheme: dark) { :root { --bg: #121417; --text: #e9ebf0;
  --muted: #9aa0a8; --rule: rgba(255,255,255,0.16); --accent: #6c9dff; --shade: #1c1f24; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.65
  -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
main { max-width: 46rem; margin: 0 auto; padding: 2.5rem 1.25rem 6rem; }
nav.crumbs { font-size: 0.875rem; color: var(--muted); margin-bottom: 2rem; }
a { color: var(--accent); }
a:hover { text-decoration: none; }
h1, h2, h3, h4 { line-height: 1.25; letter-spacing: -0.015em; }
h1 { font-size: 2rem; margin: 0 0 1.5rem; }
h2 { font-size: 1.4rem; margin: 2.75rem 0 0.75rem; padding-top: 0.75rem; border-top: 1px solid var(--rule); }
h3 { font-size: 1.1rem; margin: 2rem 0 0.5rem; }
hr { border: 0; border-top: 1px solid var(--rule); margin: 2.5rem 0; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.875em; background: var(--shade); padding: 0.1em 0.35em; border-radius: 4px; }
pre { background: var(--shade); padding: 0.9rem 1rem; border-radius: 8px; overflow-x: auto; }
pre code { background: none; padding: 0; font-size: 0.85em; }
blockquote { margin: 1.5rem 0; padding: 0.1rem 1rem; border-left: 3px solid var(--accent);
  background: var(--shade); border-radius: 0 6px 6px 0; }
table { border-collapse: collapse; width: 100%; display: block; overflow-x: auto; margin: 1.25rem 0; }
th, td { border: 1px solid var(--rule); padding: 0.45rem 0.7rem; text-align: left; vertical-align: top; }
th { background: var(--shade); }
ul.tasks { list-style: none; padding-left: 0.25rem; }
ul.tasks > li.task { margin-bottom: 1rem; }
ul.tasks input { margin-right: 0.4rem; }
del { color: var(--muted); }
.cards { display: grid; gap: 0.9rem; padding: 0; list-style: none; }
.cards a { font-weight: 600; font-size: 1.05rem; text-decoration: none; }
.cards p { margin: 0.15rem 0 0; color: var(--muted); font-size: 0.925rem; }
.cards li { border: 1px solid var(--rule); border-radius: 10px; padding: 0.9rem 1.1rem; }
footer { margin-top: 4rem; padding-top: 1rem; border-top: 1px solid var(--rule);
  color: var(--muted); font-size: 0.875rem; }
`.trim();

/** Wraps a rendered fragment in the shared page shell. */
export function page({ title, body, crumbs = true }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${STYLE}
</style>
</head>
<body>
<main>
${crumbs ? '<nav class="crumbs"><a href="./">boris docs</a></nav>\n' : ''}${body}
<footer>Part of the <a href="../">family tree</a> deployment. Built from the repository, not from a dashboard.</footer>
</main>
</body>
</html>
`;
}

/**
 * The landing page at /docs/, including the off-site link to the API manual.
 *
 * `rendered` carries each Markdown page's own H1, so the index names a
 * document the way the document names itself.
 */
export function indexPage(apiUrl, rendered = []) {
  const cards = [
    ...rendered.map((entry) => ({
      href: `${entry.slug}.html`,
      title: entry.title,
      blurb: entry.blurb,
    })),
    {
      href: 'manual/web/',
      title: 'Web app manual',
      blurb: 'What the screen shows, the four states, and the test hooks behind them.',
    },
    {
      href: `${apiUrl}/`,
      title: 'API manual',
      blurb: 'Served by the API itself, so it is always the manual for that deployment.',
    },
    {
      href: 'step-0.html',
      title: 'The step-0 page',
      blurb: 'The first artifact this project ever published, kept as it was.',
    },
  ];

  const body = `<h1>boris docs</h1>
<p>Everything this project publishes about itself. These pages used to be on
GitHub Pages; they are built from the repository into this deployment instead,
so a private repository keeps them.</p>
<ul class="cards">
${cards
  .map(
    (card) =>
      `<li><a href="${escapeHtml(card.href)}">${escapeHtml(card.title)}</a><p>${escapeHtml(card.blurb)}</p></li>`,
  )
  .join('\n')}
</ul>`;

  return page({ title: 'boris docs', body, crumbs: false });
}

/**
 * Renders the whole docs site into `out`, returning the paths written relative
 * to it — so a test can assert what a build produces without re-reading it.
 */
export function buildDocs({ root = REPO_ROOT, out = DOCS_DIR, env = process.env } = {}) {
  const apiUrl = apiBaseUrl(env, root);

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const written = [];
  const rendered = [];

  for (const entry of MARKDOWN_PAGES) {
    const markdown = readFileSync(join(root, entry.source), 'utf8');
    const title = firstHeading(markdown) ?? entry.slug;
    const body = renderMarkdown(markdown);
    writeFileSync(join(out, `${entry.slug}.html`), page({ title, body }), 'utf8');
    rendered.push({ ...entry, title });
    written.push(`${entry.slug}.html`);
  }

  // The step-0 artifact is published as it was written, not restyled: it is a
  // record of what this project looked like at step 0.
  writeFileSync(join(out, 'step-0.html'), readFileSync(join(root, 'index.html'), 'utf8'), 'utf8');
  written.push('step-0.html');

  // Copied whole: the manual references its screenshots relatively, so the
  // directory moves as a unit.
  cpSync(join(root, 'manual', 'web'), join(out, 'manual', 'web'), { recursive: true });
  written.push('manual/web/index.html');

  writeFileSync(join(out, 'index.html'), indexPage(apiUrl, rendered), 'utf8');
  written.push('index.html');

  return { out, apiUrl, written };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { out, apiUrl, written } = buildDocs();
  console.log(`built ${written.length} doc pages into ${out}; API manual at ${apiUrl}/`);
}
