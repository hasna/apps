# Changelog

All notable changes to `@hasna/knowledge` are documented here.

## Unreleased — Search overhaul (staged)

The search subsystem is being reworked in small, independently reviewable
stages. Each stage ships an idempotent migration (where schema changes) plus
genuine parity/behavior tests that fail before and pass after.

### Stage 0 — prep & parity scaffolding (this change)

- **Version reconciliation.** `main` had drifted to `0.2.81` while npm `latest`
  was `0.2.86` (published from a separate line that also carried a Store-unification
  refactor not yet on `main`; `main` in turn carried two CLI fixes — `#23`, `#24` —
  not in `0.2.86`). To keep this line publishable and ahead of the registry, the
  package version is set to `0.2.87`. The `0.2.82`–`0.2.86` Store-unification
  commits remain to be reconciled onto `main` separately; the search stages here
  touch `src/search.ts`, `src/knowledge-db.ts`, `src/serve.ts` and
  `src/db/pg-migrations.ts`, which do not overlap that refactor.
- **Parity fixtures.** Added `tests/fixtures/search-parity-fixtures.ts`: a single
  backend-agnostic corpus (multi-term AND, quoted phrase, prefix, title-vs-body
  ranking, diacritics, pagination) reused by both the SQLite and Postgres suites.
- **Characterization tests.** Added `tests/search-parity.test.ts` pinning the
  current OR-of-prefixes / no-phrase SQLite behavior so later stages produce a
  reviewable behavior diff.

### Stage 1 — SQLite full-text quality

- Real query parser in `src/search.ts`: AND-default, `"quoted phrases"`,
  `prefix*`, explicit `OR`, and `NOT` / leading-`-` negation, replacing the
  OR-of-prefixes builder. AND-first with OR fallback keeps precise multi-term
  queries precise while natural-language questions retain recall.
- bm25 column weights favor `title`/`source_uri` over body.
- New schema **v9** migration rebuilds `chunks_fts` with the diacritic-folding
  tokenizer (`porter unicode61 remove_diacritics 2`), backfilled losslessly from
  the existing stored FTS rows; idempotent and guarded by live-tokenizer
  inspection.
- `hybridSearch` gains `offset` pagination with a widened fetch window for
  stable, non-overlapping pages. Malformed `MATCH` expressions degrade to zero
  keyword hits instead of throwing.

### Stage 2 — Postgres full-text parity (top-priority correctness fix)

- Replaced the `title/content ILIKE '%q%'` + `ORDER BY created_at DESC` cloud
  path (`NoteRepo.list`) with a weighted `tsvector` generated column
  (title = A, content = B) + GIN index, queried via `websearch_to_tsquery` and
  ranked by `ts_rank_cd`. This fixes the "cloud returns nothing" bug where
  multi-term / word-order-varying queries matched no substring and results were
  ordered by recency rather than relevance.
- Postgres migrations are **appended** to `PG_MIGRATIONS` (index-derived ids,
  never inserted mid-array) and are idempotent.
- Added an in-process Postgres (`@electric-sql/pglite`, devDependency) parity
  suite running the real `NoteRepo` against the real migrations, asserting
  word-order independence, relevance-over-recency, phrase adjacency, and
  sqlite-vs-pg equivalence over the shared corpus.

## 0.2.87

Reconcile `main` with the published npm line (`npm/knowledge/v0.2.86`), which had
diverged: the deployed runtime carried a Store-unification + cloud-routing refactor
that never landed on `main`, while `main` carried two CLI fixes the published line
lacked. This release re-converges both histories.

- Merge the published release tag `npm/knowledge/v0.2.86` into `main` (merge commit,
  preserving full ancestry so future `merge-base --is-ancestor` checks pass). Brings in:
  - refactor(store): unify knowledge-item CRUD behind one Store (LocalStore + ApiStore) (1506111)
  - refactor(knowledge): remove dead raw-fetch RemoteKnowledgeClient, make registry descriptor truthful (2b6bd21)
  - fix(knowledge): close residual cloud-mode routing gaps for catalog commands (2d235a9)
  - fix(knowledge): route SDK item CRUD + inventory through the unified Store in all 3 modes (92c3fcc)
  - fix(knowledge): close split-brain read + drop dead API client and client DSN surface (5213a51)
  - fix(knowledge): stop context-pack hang, repair cloud project-panel, drop dead remote command (8daa0ea)
- Retains the two `main`-only CLI fixes on top of the refactor:
  - fix(cli): don't leak internal Error stack on usage/validation errors (#23)
  - fix(cli): make `<sub> --help` print per-command usage (#24)
- Version bumped to 0.2.87 (strictly above published 0.2.86) so npm and `main` reconverge on publish.
