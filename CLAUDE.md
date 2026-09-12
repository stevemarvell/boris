# boris

A family tree application, built as a practice ground for climbing the stages in
`docs/adoption.md` — a rendering of the stages-of-agentic-adoption document
(Boris Cherny, Jul 2026). Each stage of the climb is deliberate; do not reach for
tooling that belongs to a later stage.

`index.html` at the root is the step-0 artifact, published at
<https://stevemarvell.github.io/boris/> by GitHub Pages from `develop`.

## Layout

| Path | Holds |
| --- | --- |
| `apps/api/` | FastAPI + Strawberry GraphQL service. Deploys to Railway. |
| `apps/web/` | Ionic React app on Vite. Deploys to Vercel. |
| `data/` | The family tree itself, stored as files in this repository. |
| `docs/` | `adoption.md`, the ladder being climbed. |

## Rules

- **Every change ships as a pull request.** Branch off `develop`, push the
  branch, then open a PR with `gh pr create --base develop`. Never commit or
  push directly to `develop` — a repository ruleset enforces this. Report the
  PR URL rather than describing the change as landed; merging is the
  maintainer's call.

- **`docs/adoption.md` preserves the source wording.** It is a rendering of the
  original document, not a rewrite. Restructure the layout freely, but do not
  reword, summarise, or drop content, and keep every link intact.

- **A person is a name plus relationships, stored minimally.** Each person
  records only their parents and their spouse. Siblings, grandparents, cousins
  and children are *derived*, never stored — a file that can contradict itself
  will eventually contradict itself.

- **Merging deploys** — the Pages site, and the Vercel frontend once it exists.
  The approval path and the release path are meant to be the same.

## Deployments

| What | Where | Trigger |
| --- | --- | --- |
| Step-0 page | <https://stevemarvell.github.io/boris/> | merge to `develop` |
| API | <https://api-production-edc5.up.railway.app> | `railway up` — **not** yet git-connected |
| Web | not yet provisioned | — |

Railway builds from `apps/api/Dockerfile`, selected by the `RAILWAY_DOCKERFILE_PATH`
service variable. The `railway.json` builder setting is *not* honoured: Railpack
reads the root `package.json`, decides the repo is Node, and never looks for a
Dockerfile. The variable is what actually does the work.

The web app reads `VITE_API_URL` at build time, defaulting to
`http://localhost:8000`.

## Running it

```bash
npm install && npm run dev            # web app on http://localhost:5173
cd apps/api && uv run uvicorn api.main:app --reload   # API on :8000
```

Gates, run per workspace: `npm run typecheck`, `npm run lint`, `npm test`,
`npm run build`; `uv run pytest` and `uv run ruff check` in `apps/api`.
There is no aggregated `verify` yet, and no CI — that is the step-1 work of
building a self-verification loop, and importing it early would skip the stage.
