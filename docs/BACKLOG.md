# Backlog

Fuel for the drills in `docs/STAGES.md`. Every item is real work on this repo.

**Tags**

| Tag | Meaning |
| --- | --- |
| `[S1]` | Good first item for a single supervised session. |
| `[P]` | Parallel-safe — the listed files are disjoint from other `[P]` items. |
| `[LOOP]` | Repetitive; one brief applied over many targets. |
| `[AUTO]` | Safe for an unattended agent to pick up on its own. |

Rules: claim an item by checking its box in the branch that implements it. Every
item ships with tests and a green `npm run verify`.

---

## Step 1 — one at a time

- [ ] `[S1]` **Reject links longer than 2048 characters.** URLs beyond that are
      almost always tracking junk. `src/domain/validate.ts`, `test/validate.test.ts`.
- [ ] `[S1]` **Strip tracking parameters** (`utm_*`, `fbclid`, `gclid`) in
      `normaliseUrl`, so the same article saved from two places dedupes to one
      link. `src/domain/validate.ts`, `test/validate.test.ts`.
- [ ] `[S1]` **Add `linkjar open <id>`** to the CLI, printing the URL so it can
      be piped to a browser. `src/cli/main.ts`.
- [ ] `[S1]` **Cap tags at 10 per link** with a clear `ValidationError`.
      `src/domain/validate.ts`, `test/validate.test.ts`.

## Step 2 — parallel fan-out

Five disjoint slices. One worktree each.

- [ ] `[P]` **Search operators.** Support `tag:rust`, `is:unread`, and quoted
      phrases inside the free-text query. Parse in the domain layer, not the
      router. `src/domain/search.ts` (+ a new `src/domain/query-parser.ts`),
      `test/search.test.ts`.
- [ ] `[P]` **Export and import.** `linkjar export > links.json` and
      `linkjar import links.json`, merging by URL without creating duplicates.
      `src/cli/main.ts`, new `src/domain/transfer.ts`, new `test/transfer.test.ts`.
- [ ] `[P]` **Archive instead of delete.** Add `archivedAt` to `Link`; `DELETE`
      soft-archives, `?archived=true` lists them, and a new `--purge` flag
      really removes. `src/domain/types.ts`, `src/service.ts`,
      `test/service.test.ts`.
- [ ] `[P]` **Pagination.** `GET /api/links?limit=&cursor=` returning a
      `nextCursor`, with the web UI loading more on scroll. `src/http/router.ts`,
      `public/app.js`, `test/api.test.ts`.
- [ ] `[P]` **Notes on a link.** An optional free-text `note` field, editable
      from the UI, searchable by the ranker. `src/domain/types.ts`,
      `public/index.html`, `public/app.js`.
- [ ] `[P]` **Rate-limit writes.** A small in-process token bucket on `POST`,
      returning `429` with `retry-after`. New `src/http/rate-limit.ts`,
      `test/rate-limit.test.ts`.
- [ ] `[P]` **Structured request logging.** One JSON line per request — method,
      path, status, duration — on stderr, off during tests. New
      `src/http/logging.ts`.

## Step 3 — routines and fan-out

- [ ] `[LOOP]` **Property-test the domain layer.** For each exported function in
      `src/domain/`, add a round-trip or invariant test (e.g. `normaliseUrl` is
      idempotent; `search` never returns a link that fails its own filter).
- [ ] `[LOOP]` **Error-path coverage.** For every `throw` in `src/`, assert there
      is a test that reaches it. Add the missing ones.
- [ ] `[LOOP]` **JSDoc every exported symbol** that lacks one, saying *why* it
      exists rather than restating the signature.
- [ ] `[AUTO]` **Keep the README's CLI section in sync** with the actual commands
      in `src/cli/main.ts`.
- [ ] `[AUTO]` **Dependency freshness.** Check `npm outdated`, bump dev
      dependencies one at a time, `verify` after each, open one PR per bump.
- [ ] `[AUTO]` **Dead-code sweep.** Find exports nothing imports; delete or
      justify them in a comment.

## Step 4 — worth automating end to end

- [ ] **Swap the storage engine.** Introduce a SQLite-backed `Store` behind the
      existing interface with zero changes above `src/store/`. A good test of
      whether the seam is real.
- [ ] **Accessibility pass on the web UI,** verified in a real browser: keyboard
      navigation, focus order, labels, contrast in both colour schemes.
- [ ] **A benchmark harness** that fails `verify` if search over 10k links
      regresses by more than 20%.
- [ ] **Multi-user support** — an owner on every link, auth on the API, and the
      whole migration driven as a single intent.
