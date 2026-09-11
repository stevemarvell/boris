# linkjar

A small bookmarks service. It exists so you can practise scaling from one
supervised agent to many autonomous ones — see `docs/STAGES.md`.

## The verification loop

`npm run verify` is the contract. It runs typecheck → lint → test → build.
**Never report work as done until `npm run verify` passes.** Run it yourself;
do not ask the user to run it for you.

Individual gates: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

## Layout

| Path | Holds |
| --- | --- |
| `src/domain/` | Pure logic — validation, search ranking, types. No I/O. |
| `src/store/` | Persistence behind the `Store` interface. |
| `src/service.ts` | Application layer shared by the HTTP API and the CLI. |
| `src/http/` | `node:http` router and server. |
| `src/cli/` | Command-line entry point. |
| `public/` | Static web UI — plain HTML/CSS/JS, no build step. |
| `test/` | `node:test` suites mirroring `src/`. |

## Rules

- **No runtime dependencies.** `package.json` has `devDependencies` only, and it
  stays that way. If a task seems to need a library, write the small version.
- **Domain stays pure.** Nothing in `src/domain/` may import `node:fs`,
  `node:http`, or reach the network. Push I/O into `src/store/` or `src/http/`.
- **Every behaviour change ships with a test.** Bug fix → a test that fails
  before the fix. New feature → tests for the happy path and the error path.
- **Errors are typed.** Throw `ValidationError` (→ HTTP 400) or `NotFoundError`
  (→ HTTP 404) from the domain and service layers. The router maps them; it does
  not invent status codes.
- **`console.log` is confined** to `src/cli/` and `src/http/server.ts`. ESLint
  enforces this — do not silence the rule.
- **Type-only imports use `import type`.** Strict mode is on, including
  `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`; write code that
  satisfies them rather than casting with `as` or `!`.
- **Match the surrounding style.** Comments explain *why*, not *what*.

## Running it

```bash
npm start                 # http://localhost:8787  (add --ephemeral for in-memory)
npm run cli -- list       # CLI against data/links.json
LINKJAR_DB=data/scratch.json npm start
```

When you need a server for end-to-end checks, start it on a port derived from
your worktree so parallel agents do not collide: `PORT=88xx npm start -- --ephemeral`.
