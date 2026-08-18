# Hasna Notes — two-backend storage

The notes package follows the fleet two-backend contract: one wire dialect,
two storage surfaces per side.

## Client: exactly two connections

A notes client (CLI, MCP server, macOS app) has exactly two connections:

- **local** — the on-box SQLite + markdown store (the app's data contract,
  `tools/notes-lib.mjs`), selected when `HASNA_NOTES_API_URL` is unset;
- **http** — the server HTTP API over the personalnotes/v1 dialect
  (`/api/v1/*`, Bearer api-key), selected when `HASNA_NOTES_API_URL` **and**
  `HASNA_NOTES_API_KEY` are set.

Selection lives in ONE resolver: `client/transport.mjs`
(`resolveNotesClientTransport`). An API URL without its key **fails closed** —
there is no anonymous fallback and no default localhost server. Client
note-reading and note-writing paths never read `HASNA_NOTES_DATABASE_URL` and
never open PostgreSQL. The one exception is the `notes storage migrate
--dry-run` planning verb, which reads the DSN and opens a short-lived PG pool
to compute the migration plan (fail-closed: no DSN, no plan).

Retired selectors (`PERSONALNOTES_MODE`, `HASNA_NOTES_STORAGE_MODE`,
`HASNA_NOTES_MODE`, `NOTES_STORAGE_MODE`, `NOTES_MODE`) fail loud even when
blank. The old sync-era default (API URL absent -> `http://127.0.0.1:8788`)
is gone: absent means local.

## Server: the data backend is the only switch

`HASNA_NOTES_DATABASE_URL` present selects the **PostgreSQL** backend;
absent selects **SQLite** (unchanged default at
`~/.hasna/apps/notes-server/server.db`). No mode enums. The DSN is never
logged, printed, or echoed in errors.

The PostgreSQL schema (`server/pg-migrations.ts`) is the SQLite schema
translated, with two deliberate differences:

- `sync_batches` is **dropped** — multi-machine sync is being removed
  fleet-wide. `note_events` is kept.
- `api_keys` comes from `@hasna/contracts/auth` (ApiKeyStore): keys are
  minted and verified with the signing secret `HASNA_NOTES_API_SIGNING_KEY`
  (fallbacks `API_KEY_SIGNING_SECRET`, `HASNA_API_SIGNING_KEY`) as
  `hasna_notes_` tokens. The SQLite backend keeps the dialect's `pn_` keys.

Migrations apply through the vendored storage kit's `MigrationLedger`
(sha256 checksums, drift/downgrade guards, append-only ledger):

```bash
HASNA_NOTES_DATABASE_URL_OWNER=<owner-dsn> \
  bun scripts/apply-postgres-migrations.mjs --dry-run --json   # plan only
HASNA_NOTES_DATABASE_URL_OWNER=<owner-dsn> \
  bun scripts/apply-postgres-migrations.mjs                    # apply
```

The owner-scoped DSN (`HASNA_NOTES_DATABASE_URL_OWNER`) is preferred because
migrations run DDL; it falls back to the app DSN for local runs. Inject DSNs
through the runtime's credential consumer — never as literal shell values.

Live-PostgreSQL proof gate (storage.pgTestGate in hasna.contract.json),
**fail-closed**: exits 2 when `NOTES_TEST_DATABASE_URL` is unset.

```bash
NOTES_TEST_DATABASE_URL=<throwaway-dsn> bun run test:pg
```

## The wire dialect is documented, not renamed

The server speaks the `personalnotes/v1` dialect on both backends — same
paths, same JSON shapes, same error envelope. The future hosted wrapper
speaks this same dialect, so it is documented (`/openapi.json` served by
notes-serve, and this file) rather than renamed. One backend difference is
visible on the wire: api keys issued by the PostgreSQL backend carry the
`hasna_notes_` contracts format instead of `pn_`. Clients receive the key
from the server at login and never parse its format.

## Storage verbs

```bash
notes storage status [--json]        # client transport + server backend selection
notes storage migrate --dry-run [--json]  # postgres migration plan (no mutation)
```

`notes storage status` reports selection only — never credentials. `notes
storage migrate` requires `--dry-run`; the real apply path is the migration
runner script above.
