---
name: docs-site
description: How this project's published documentation is built and served — what lives at /docs/ on Vercel, what the API serves at its own root, and the files that must change together to add or remove a page. Read before editing docs/, scripts/build-docs.mjs, scripts/markdown.mjs, manual/, or the page lists in smoke.yml.
---

# The documentation site

Adding one page touches six files. They are listed at the end; missing one
means a page that builds locally and 404s on the deployment.

## Documentation

Everything GitHub Pages used to publish is now served by the two deployments
this project already had. Nothing is hosted anywhere a private repository
cannot reach.

| URL | Source | Carried by |
| --- | --- | --- |
| `/docs/` | `scripts/build-docs.mjs` | Vercel |
| `/docs/adoption.html` | `docs/adoption.md` | Vercel |
| `/docs/data-governance.html` | `docs/data-governance.md` | Vercel |
| `/docs/sops.html` | `docs/sops.md` | Vercel |
| `/docs/manual/web/` | `manual/web/` | Vercel |
| `/docs/step-0.html` | `index.html` | Vercel |
| `/` on the API | `manual/api/` | the API image |

The web app's `prebuild` runs `scripts/build-docs.mjs`, which renders the
Markdown with `scripts/markdown.mjs` and writes `apps/web/public/docs/`. That
directory is generated, gitignored, and deleted on every run — edit the
sources, never the output.

The API manual is the one that does **not** go to Vercel. It ships inside the
API image and is mounted at the service root, so:

- its "try it" console, where `API_ENVIRONMENT=development` enables it, posts
  to `/graphql` on the origin it was loaded from, which means a pull request
  environment's manual exercises *that* API rather than production's;
- it needs no CORS allowance at all, which is why `stevemarvell.github.io` is
  no longer in `ALLOWED_ORIGIN_REGEX`.

The mount is a catch-all at `/`, registered after `/graphql` and `/health` so
those still win. A missing manual disables the mount rather than failing
startup; `smoke` fetches it after every merge, so a build that drops it fails
there instead.

## Adding or removing a page, the full list

1. `scripts/build-docs.mjs` — the `MARKDOWN_PAGES` entry
2. `apps/web/src/build-docs.test.ts` — the stand-in repository and its assertions
3. `apps/web/e2e/docs.spec.ts` — the index link list, and a render test
4. `.github/workflows/smoke.yml` — the deployed path loop
5. `CLAUDE.md` — the Layout row, if the source file is new
6. the Markdown source itself

`scripts/markdown.mjs` renders a deliberate subset. Check what it supports
before using a construct; an unsupported one renders as literal text.
