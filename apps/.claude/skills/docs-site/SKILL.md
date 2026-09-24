---
name: docs-site
description: How this project's published documentation is built and served — what lives at /docs/ on Vercel, and the files that must change together to add or remove a page. Read before editing docs/, apps/web/scripts/build-docs.mjs, scripts/markdown.mjs, manual/, or the page list in apps/web/smoke.sh.
---

# The documentation site

Adding one page touches six files. They are listed at the end; missing one
means a page that builds locally and 404s on the deployment.

## Documentation

Everything this project publishes about itself is served by the web
deployment. Nothing is hosted anywhere a private repository cannot reach.

| URL | Source | Carried by |
| --- | --- | --- |
| `/docs/` | `apps/web/scripts/build-docs.mjs` | Vercel |
| `/docs/adoption.html` | `docs/adoption.md` | Vercel |
| `/docs/data-governance.html` | `docs/data-governance.md` | Vercel |
| `/docs/sops.html` | `docs/sops.md` | Vercel |
| `/docs/extraction.html` | `docs/extraction.md` | Vercel |
| `/docs/manual/web/` | `manual/web/` | Vercel |
| `/docs/step-0.html` | `index.html` | Vercel |

The web app's `prebuild` runs `apps/web/scripts/build-docs.mjs`, which renders the
Markdown with `scripts/markdown.mjs` and writes `apps/web/public/docs/`. That
directory is generated, gitignored, and deleted on every run — edit the
sources, never the output.

## Adding or removing a page, the full list

1. `apps/web/scripts/build-docs.mjs` — the `MARKDOWN_PAGES` entry
2. `apps/web/src/build-docs.test.ts` — the stand-in repository and its assertions
3. `apps/web/e2e/docs.spec.ts` — the index link list, and a render test
4. `apps/web/smoke.sh` — the deployed path loop
5. `CLAUDE.md` — the Layout row, if the source file is new
6. the Markdown source itself

`scripts/markdown.mjs` renders a deliberate subset. Check what it supports
before using a construct; an unsupported one renders as literal text.
