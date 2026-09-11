# linkjar

A small bookmarks service — HTTP API, CLI, and a plain web UI — with no runtime
dependencies.

It is real code, but its purpose is to be a **practice ground for scaling
agentic development**: a repo with a trustworthy verification loop and a real
backlog, so you can work through the steps in [`docs/STAGES.md`](docs/STAGES.md)
from one supervised agent to many autonomous ones.

## Quick start

```bash
npm install
npm run verify        # typecheck → lint → test → build. The contract.
npm start             # http://localhost:8787
```

```bash
npm run cli -- add https://example.com/article --tag reading
npm run cli -- list --unread
npm run cli -- tags
```

Data lives in `data/links.json` (override with `LINKJAR_DB`). Run the server
with `--ephemeral` to keep everything in memory.

## The verification loop

`npm run verify` is the thing the whole exercise rests on. An agent that can run
it and get a green result can be trusted a little further than one that cannot —
which is exactly how you climb from step 1 to step 4.

| Gate | Command | Catches |
| --- | --- | --- |
| Types | `npm run typecheck` | strict TS, including unchecked index access |
| Lint | `npm run lint` | style, layering rules, stray `console.log` |
| Tests | `npm test` | 33 unit + integration tests (`node:test`) |
| Build | `npm run build` | emit to `dist/` actually works |

## Where to go next

| File | What it is for |
| --- | --- |
| [`docs/STAGES.md`](docs/STAGES.md) | The five steps, with a drill and an exit test for each |
| [`docs/BACKLOG.md`](docs/BACKLOG.md) | Real work, tagged by which step it suits |
| [`CLAUDE.md`](CLAUDE.md) | The standards agents must follow in this repo |
| [`.claude/settings.json`](.claude/settings.json) | Pre-approved safe commands, so auto mode does not stall |

## API

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/health` | liveness |
| `GET` | `/api/links` | `?q=`, `?tag=`, `?unread=true` |
| `POST` | `/api/links` | `{ url, title?, tags? }` — idempotent on URL |
| `GET` | `/api/links/:id` | |
| `PATCH` | `/api/links/:id` | `{ read: boolean }` |
| `DELETE` | `/api/links/:id` | |
| `GET` | `/api/tags` | tag counts, most used first |

## Layout

```
src/domain/   pure logic — validation, search ranking, types (no I/O)
src/store/    persistence behind a Store interface (memory + JSON file)
src/service.ts  application layer shared by the API and the CLI
src/http/     node:http router and server
src/cli/      command-line entry point
public/       static web UI, no build step
test/         node:test suites mirroring src/
```
