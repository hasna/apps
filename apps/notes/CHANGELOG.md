# @hasna/notes

## 0.2.1

### Patch Changes

- 9ef7bee: CLI note commands route through the HTTP API when configured: `notes list`,
  `notes get`, `notes create` and `notes delete` now dispatch through
  `HASNA_NOTES_API_URL` + `HASNA_NOTES_API_KEY` via the personalnotes/v1 wire
  dialect (the plain HTTP client the single-server model specifies) instead of
  silently operating on the local store. Fixes the SDK's `resolveNotesClientStore`
  (re-export-only imports shadowed local bindings, so the resolver threw
  `ReferenceError` on the http path). Adds `notes --version`. The Dockerfile
  bakes the public Amazon RDS global CA bundle so the storage kit's verified TLS
  (`sslmode=require`) can validate the RDS server certificate in the internal
  deployment; the bundle path is served to the kit through `PGSSLROOTCERT`.

## 0.2.0

### Minor Changes

- 82060a8: Remove multi-machine sync machinery (single-server model): the `notes sync`/`cloud`/`billing` CLI verbs, the sync daemon and service install, the GUI SyncScheduler, sync-state handling, the machine manifest and the Machines UI surface, and the server's `/api/v1/sync` endpoint with its `sync_batches` table. The client is now a plain HTTP API client; the `personalnotes/v1` wire dialect and the server's CRUD/export endpoints are unchanged. The one-release pre-rename `PERSONALNOTES_*` env compatibility aliases are removed with it.
- 913fa46: Two-backend storage transition (cloud workflow task 5b2d66b4, owner-authorized 2026-08-17):

  - Server: `HASNA_NOTES_DATABASE_URL` present selects PostgreSQL (schema_migrations ledger, sha256 checksums, sync_batches dropped in the new backend), absent selects the unchanged SQLite default. Migration runner `scripts/apply-postgres-migrations.mjs` (`--dry-run --json`, owner DSN `HASNA_NOTES_DATABASE_URL_OWNER`; the DSN is never logged).
  - Client: one transport resolver — `HASNA_NOTES_API_URL` present selects the HTTP API client over the personalnotes/v1 dialect (api-key auth; a URL without a key fails closed), absent selects the local SQLite+markdown store. Client code never reads the database URL and never opens Postgres.
  - `notes storage status` / `notes storage migrate --dry-run` verbs; hasna.contract.json declares the storage block, service metadata, sdk surface, and the Dockerfile self-host artifact; `contracts validate apps/notes/hasna.contract.json` passes.
  - Bins are bun-only: all three bins (`notes`, `notes-mcp`, `notes-serve`) now carry `#!/usr/bin/env bun` and `engines` declares `bun >= 1.0` — the CLI graph imports the vendored storage-kit and `server/pg-migrations.ts`, which only Bun can resolve (Node cannot load the `.js`-specifier `.ts` modules).

  Breaking for downstream consumers: the CLI/MCP bins require Bun (previously ran under Node), and multi-machine sync machinery is removed in the sibling PR (single-server model).

## 0.1.1

### Patch Changes

- 603420e: macOS app rename + proper signing: the WKWebView shell builds as HasnaNotes.app (bundle id com.hasna.notes unchanged), signed with the fleet Developer ID identity "Developer ID Application: VASILE ANDREI HASNA (HKZ326A8Y3)" instead of ad-hoc. In-app UI strings, web UI branding, and the JS bridge global are renamed to HasnaNotes (window.PersonalNotes alias removed); the sidecar auth header is now X-Hasna-Notes-Token only. Build/deploy scripts renamed to scripts/build_notes.sh and scripts/deploy_notes.sh; deploy backs up and removes legacy installs that share the bundle id (bundle-id scan, no hardcoded legacy display names).
- 7c0cc88: First release under the new name: the app previously published as @hasna/personalnotes is renamed to @hasna/notes (apps/notes, HasnaNotes.app, bundle id com.hasna.notes). Renames the CLI/MCP/serve bins to notes/notes-mcp/notes-serve, moves env vars to HASNA*NOTES*\* (legacy names still honored for one release with a deprecation warning), migrates the config path to ~/.config/hasna-notes/config.json, and fixes the package contract (cli-with-store with the SQLite storage block). The sync wire dialect keeps the personalnotes/v1 name.
