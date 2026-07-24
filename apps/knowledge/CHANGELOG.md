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

### Stage 1 — SQLite full-text quality (planned)

Real query parser (AND default, `"phrase"`, `prefix*`, boolean), bm25 column
weights favoring title/source_uri, diacritic-insensitive tokenizer.

### Stage 2 — Postgres full-text parity (planned, top priority)

Replace the `ILIKE`-substring + recency-only cloud path with a weighted
`tsvector` + GIN index and `websearch_to_tsquery` / `ts_rank_cd` ranking so the
hosted service returns the same results as local instead of near-empty,
recency-ordered rows.
