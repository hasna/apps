# Changelog

All notable changes to `@hasna/personalnotes` are documented here.

## [0.1.0] - 2026-07-24

### Added — dual storage (SQLite + PostgreSQL)

- Storage adapter layer under `src/lib/storage/` following the loops
  (hasna-storage-standard) pattern, with a single backend-tagged
  `NoteStorageContract` consumed by all surfaces:
  - `contract.ts` — async, backend-discriminated interface + migration types.
  - `store.ts` / `sqlite.ts` — synchronous `bun:sqlite` store wrapped by the
    async `SqliteNoteStorage`; SQLite default at
    `~/.hasna/personalnotes/personalnotes.db`.
  - `postgres.ts` — generic PostgreSQL migration engine (transaction-scoped
    advisory lock + per-migration sha256 checksum verification + ledger).
  - `postgres-note-storage.ts` — full `NoteStorageContract` on Postgres, at
    row-level parity with SQLite (shared row mappers in `row.ts`).
  - `postgres-schema.ts` / `sqlite-schema.ts` — exported, frozen, checksummed
    migration lists; never edit a released migration, append instead.
  - `pg-executor.ts` — `pg.Pool` executor (server-side only).
  - `env.ts` — `HASNA_PERSONALNOTES_*` config resolution and an engine factory
    that selects SQLite for `local` and Postgres for `self_hosted`/`cloud`
    (fails closed when a remote mode has no `DATABASE_URL`, to avoid split-brain).
- Idempotent, ledgered migrations on **both** engines.
- Package `./storage`, `./storage/contract`, `./storage/sqlite`,
  `./storage/postgres`, `./storage/postgres-schema` exports.
- Hermetic `bun test` suite (passes with no Postgres present) plus an
  env-gated live Postgres suite (`PERSONALNOTES_TEST_DATABASE_URL`) proving
  cross-engine parity and concurrent-migrator safety.

[0.1.0]: https://github.com/hasna/personalnotes/releases/tag/v0.1.0
