# Hasna Notes storage boundaries

## Clients: one authenticated HTTPS connection

The CLI, MCP server, and SDK resolve exactly one client connection in
`client/transport.mjs`: the `personalnotes/v1` API selected by
`HASNA_NOTES_API_URL` and authenticated with `HASNA_NOTES_API_KEY`.

- Both values are mandatory and partial configuration fails closed.
- The URL must be absolute HTTPS without credentials, query, or fragment.
- Missing configuration never selects SQLite, Markdown files, or localhost.
- `HASNA_NOTES_DATABASE_URL` is rejected in a client environment.
- Retired mode selectors fail loud even when blank.
- Authenticated API and title-sidecar requests use `redirect: error`; 301, 302,
  303, 307, and 308 are never followed, even to the same HTTPS origin.

The package root is the remote SDK. Pure formatting helpers are available only
at `@hasna/notes/compat/markdown-format`, without local CRUD.

## Server: PostgreSQL only

Only `notes-serve` and server migration tooling consume database credentials.
A valid server-only `HASNA_NOTES_DATABASE_URL` is mandatory. Missing/invalid
configuration fails before listening. No SQLite default, `--db` flag or
`HASNA_NOTES_SERVER_DB` selector remains. SQLite is an unshipped test fixture;
production imports do not load it. A DSN is never logged or returned.

PostgreSQL schema changes use the checksum ledger:

```sh
HASNA_NOTES_DATABASE_URL_OWNER=<owner-dsn> \
  bun scripts/apply-postgres-migrations.mjs --dry-run --json
HASNA_NOTES_DATABASE_URL_OWNER=<owner-dsn> \
  bun scripts/apply-postgres-migrations.mjs
```

The live PostgreSQL gate fails closed when its disposable test DSN is absent:

```sh
NOTES_TEST_DATABASE_URL=<throwaway-dsn> bun run test:pg
```

## XDG-native paths and migration

Maintenance writes use the in-package XDG resolver. Exact overrides retain
their established precedence: `HASNA_NOTES_HOME`, `HASNA_NOTES_ROOT`, then
`NOTES_HOME`. Legacy `~/.hasna/notes` and `~/.hasna/apps/notes` roots are
migration sources only and are never selected or copied on startup.

```sh
notes storage migrate-legacy-path --source legacy --dry-run --json
notes storage migrate-legacy-path --source legacy --yes --plan-fingerprint <reviewed-hash> --json
notes storage migrate-legacy-path --source nested --dry-run --json
notes storage migrate-legacy-path --source server-nested --dry-run --json
```

The `server-nested` source is `~/.hasna/apps/notes-server`. Stop all legacy writers
before copying archived SQLite/Markdown data; transient SQLite `-shm` files are skipped.

The explicit migration is copy-only, not a PostgreSQL import or a local-store
selector. Planning hashes source bytes and binds file metadata plus directory
identities. Apply requires the dry-run fingerprint, stages at most 256 MiB of
reviewed bytes, and uses descriptor-relative no-follow directory/file operations
on macOS/Linux with Bun. Every component must be a canonical, non-symlink path.
Root/parent replacement cannot redirect writes. Source changes fail closed;
stop writers before planning. Conflicts are rejected, files/receipts are created
exclusively with owner-only modes, and sources are never changed. Existing
receipts must match the source snapshot and cannot be overwritten. Re-run a
fresh dry-run for idempotence. Failure may leave verified copies for manual
inspection, never automatic deletion; remove nothing until independently reviewed.

## Wire compatibility

The PostgreSQL server retains the `personalnotes/v1` paths and JSON shapes. That
wire name is shared with the separate `hasna-products/personalnotes` product and
must not be renamed.
