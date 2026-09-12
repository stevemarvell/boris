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

- **Merging deploys.** `develop` publishes the Pages site, the Vercel frontend,
  and the Railway API. The approval path and the release path are the same.

- **Deployment config lives in the repo, not in dashboards.** A setting only
  visible in a web console is invisible to everyone working here.

## Deployments

| What | Where | Built from |
| --- | --- | --- |
| Step-0 page | <https://stevemarvell.github.io/boris/> | `index.html`, Pages, `develop` |
| API | <https://api-production-1107d5.up.railway.app> | `apps/api/Dockerfile`, Railway project `boris-api` |
| Web | <https://boris-web-eta.vercel.app> | Vercel project `family-tree`, root directory `apps/web` |

Two settings are load-bearing and non-obvious:

- Railway ignores `railway.json`'s `builder` field. Railpack reads the root
  `package.json`, concludes the repo is Node, and fails with *"No start command
  detected"* without looking for a Dockerfile. The `RAILWAY_DOCKERFILE_PATH`
  service variable is what actually selects it.
- Vercel's Root Directory is `apps/web`, set in the dashboard. That means a
  `vercel.json` at the repository root is never read — Vercel looks for it
  inside the root directory. Put Vercel config in `apps/web/`.

`VITE_API_URL` is read at build time and set in `apps/web/.env.production`. It
is a public URL, not a secret.

## Running it

```bash
npm install && npm run dev            # web app on http://localhost:5173
cd apps/api && uv run uvicorn api.main:app --reload   # API on :8000
```

Gates, run per workspace: `npm run typecheck`, `npm run lint`, `npm test`,
`npm run build`; `uv run pytest` and `uv run ruff check` in `apps/api`.
There is no aggregated `verify` yet, and no CI — that is the step-1 work of
building a self-verification loop, and importing it early would skip the stage.
