---
"@hasna/notes": minor
---

Two-backend storage transition (cloud workflow task 5b2d66b4, owner-authorized 2026-08-17):

- Server: `HASNA_NOTES_DATABASE_URL` present selects PostgreSQL (schema_migrations ledger, sha256 checksums, sync_batches dropped in the new backend), absent selects the unchanged SQLite default. Migration runner `scripts/apply-postgres-migrations.mjs` (`--dry-run --json`, owner DSN `HASNA_NOTES_DATABASE_URL_OWNER`; the DSN is never logged).
- Client: one transport resolver — `HASNA_NOTES_API_URL` present selects the HTTP API client over the personalnotes/v1 dialect (api-key auth; a URL without a key fails closed), absent selects the local SQLite+markdown store. Client code never reads the database URL and never opens Postgres.
- `notes storage status` / `notes storage migrate --dry-run` verbs; hasna.contract.json declares the storage block, service metadata, sdk surface, and the Dockerfile self-host artifact; `contracts validate apps/notes/hasna.contract.json` passes.
- Bins are bun-only: all three bins (`notes`, `notes-mcp`, `notes-serve`) now carry `#!/usr/bin/env bun` and `engines` declares `bun >= 1.0` — the CLI graph imports the vendored storage-kit and `server/pg-migrations.ts`, which only Bun can resolve (Node cannot load the `.js`-specifier `.ts` modules).

Breaking for downstream consumers: the CLI/MCP bins require Bun (previously ran under Node), and multi-machine sync machinery is removed in the sibling PR (single-server model).
