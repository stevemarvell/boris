# boris

A practice ground for running software work with AI agents, climbing the steps
in [`docs/adoption.md`](docs/adoption.md), a rendering of *Steps of AI
Adoption* (Boris Cherny, Jul 2026). The thing being built is the loop that
builds software — not any particular application it happens to be running
against.

## Two layers

```mermaid
flowchart TB
  subgraph AI["AI layer — .claude/ · scripts/ · .github/ · telemetry/ · CLAUDE.md"]
    direction LR
    verify[verify] --- review[review] --- isolate[worktrees] --- deploy[deploy] --- smoke[smoke] --- triage[triage]
  end
  manifest[("project.json")]
  subgraph APP["Application — apps/ · apps/CLAUDE.md"]
    direction LR
    api["api<br/>FastAPI health check"] --- web["web<br/>React + project docs"]
  end
  AI -- "reads the application only through" --> manifest
  APP -- "declares itself in" --> manifest
```

**The AI layer** is the machinery that works on the application:

- the contract (`npm run verify`) and a stop hook that blocks an agent from
  ending its turn while `verify` is red, giving up after three attempts;
- automatic code and security review on every pull request;
- per-agent worktrees with their own ports;
- an optional per-app `deploy` block, build skipping, post-merge smoke and
  preview cleanup for whichever apps actually have one;
- `triage` and the `work-backlog`/`drive-pr` skills, which pick issues and
  drive them to merge within declared limits.

**The application**, under `apps/`, is currently two placeholders — a
health-check API and a web shell serving this repository's own
documentation — while a real workload is chosen. Neither is deployed: this
repository's own default is nothing deployed anywhere, so `npm run verify` is
what keeps them green, not a live Vercel project. The AI layer learns about
the application only from [`project.json`](project.json); swapping in a real
application means changing `apps/` and that one file, nothing else in the AI
layer. `npm run deploy:add` is what a repository built from this one uses to
put an app on Vercel.

## Quick start

Needs Node 22, [uv](https://docs.astral.sh/uv/) and Python 3.12.

```bash
npm run bootstrap     # npm ci, uv sync per Python app, Playwright, the LSP servers
npm run verify        # the whole contract: the AI layer's tests, then every app's checks
npm run dev           # the web app on http://localhost:5173
```

The API locally, with its developer consoles on:

```bash
cd apps/api && API_ENVIRONMENT=development uv run uvicorn api.main:app --reload
```

Changing a dependency needs npm 11 for the lock step (`npx npm@11 install`);
[`CLAUDE.md`](CLAUDE.md) says why.

## How a change travels

```mermaid
flowchart LR
  issue["Issue<br/>ranked, with a done-when"] --> triage["triage<br/>≤ 3 per run"]
  triage --> pr["Pull request<br/>own worktree"]
  pr --> checks{"verify<br/>(merge gate)"}
  pr -.-> reviews["code + security review,<br/>census, contention<br/>(advisory)"]
  checks -- green --> merge[Merge to develop]
  merge --> deploy["deployed apps build,<br/>or skip unchanged ones<br/>(none, by default)"]
  deploy --> smoke["smoke: this commit?<br/>then the app's checks"]
  merge --> prune["previews of the<br/>closed PR deleted"]
```

1. **An issue** says what is wrong and what "done" looks like, with a rank
   label (`critical`, `high` or `medium`). Work for a person is labelled
   `human` and `do not automate`.
2. **Triage** (`node scripts/triage.mjs`) picks what an agent may take on:
   it skips issues a person owns, issues already in flight, and issues with
   open dependencies, and takes at most three per run.
3. **A pull request**, written by an `implementer` agent in its own worktree.
   `verify` is the one check the coordinator waits for before merging;
   nothing mechanical requires it on a free-plan private repository. The code review, security review, test census and cross-PR
   conflict check comment on it but don't block it.
4. **Merge deploys whatever has a `deploy` block.** By default nothing does
   — `npm run deploy:add` is what adds one — but a deployed app builds from
   `develop`, unless nothing it reads changed, in which case the build is
   skipped.
5. **Smoke** checks each deployed app is serving this commit (or an
   equivalent skipped build), then runs that app's own checks. With nothing
   deployed, it finishes green with a notice instead.
6. **Preview cleanup:** closing the pull request deletes any deployed app's
   preview deployments.

## Swapping the application

1. Replace what is under `apps/`, including `apps/CLAUDE.md` and `smoke.sh`,
   and the app skills in `apps/.claude/skills/`.
2. Rewrite [`project.json`](project.json). Each app declares:

   | Field | Meaning |
   | --- | --- |
   | `path`, `toolchain` | Where it lives; `python` or `node`. |
   | `verify` | Its checks, run from its directory by `npm run verify`. |
   | `reads`, `ignores` | What its build reads, so unchanged builds are skipped. |
   | `deploy` | Optional. `{ provider, team, project, url, commitEndpoint }` — where it answers and the endpoint reporting the commit it was built from. `npm run deploy:add` writes this for you. |
   | `smoke` | Its post-deploy checks, a script inside the app, run when `deploy` is set. |

3. **To actually deploy an app**, run `npm run deploy:add -- vercel --app
   <app> ...` (`scripts/deploy/add.mjs`). It writes the `deploy` block, drops
   in that provider's `vercel.json` and `deployment` skill
   (`scripts/deploy/vercel/template/`), and prints the steps that are yours:
   creating the real Vercel project, turning off Deployment Protection's
   Vercel Authentication, copying the real production URL, and adding
   `VERCEL_TOKEN`.
4. **Rewrite [`docs/data-governance.md`](docs/data-governance.md)** before
   deploying anything real. Its verdict applies while nothing is deployed,
   and any real deployment voids it.

## Documentation

| Where | What |
| --- | --- |
| [`CLAUDE.md`](CLAUDE.md) | The AI layer's rules, which every agent session loads. |
| [`apps/CLAUDE.md`](apps/CLAUDE.md) | The application's rules, layout and deployments. |
| [`docs/sops.md`](docs/sops.md) | How agent work is run, including every loop's declared limit. |
| [`docs/data-governance.md`](docs/data-governance.md) | What is exposed, why, and what would change that. |
| [`docs/adoption.md`](docs/adoption.md) | The adoption ladder being climbed. |

Nothing is deployed by default, so none of this is published anywhere today.
`npm run deploy:add` is what would make the web app's `/docs/` and the API's
own manual reachable, once there is a deployment for them to live on.

## Repository secrets

| Secret | Used by |
| --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | The code and security reviews, and `@claude` in issues and PRs. |
| `VERCEL_TOKEN` | Preview cleanup, once `npm run deploy:add` adds a Vercel deployment. Not set today — nothing is deployed. Team-scoped; record its expiry here once it is added. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Merge notifications. |
| `GRAFANA_CLOUD_OTLP_ENDPOINT`, `GRAFANA_CLOUD_OTLP_AUTH` | Telemetry from the Claude CI jobs ([`telemetry/`](telemetry/README.md)). |

Deploys don't use a token: they run through Vercel's Git integration.
