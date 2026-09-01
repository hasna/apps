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

The package-root Markdown/frontmatter library remains available only as an
explicit format/import/export surface. It is not a client transport.

## Server: SQLite or PostgreSQL

Only `notes-serve` and server migration tooling select a database backend.
`HASNA_NOTES_DATABASE_URL` selects PostgreSQL; otherwise the server uses SQLite
at the `@hasna/paths` XDG data root. A DSN is never logged or returned.

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

New server and maintenance writes use `@hasna/paths`. Exact overrides retain
their established precedence: `HASNA_NOTES_HOME`, `HASNA_NOTES_ROOT`, then
`NOTES_HOME`. Legacy `~/.hasna/notes` and `~/.hasna/apps/notes` roots are
migration sources only and are never selected or copied on startup.

```sh
notes storage migrate-legacy-path --source legacy --dry-run --json
notes storage migrate-legacy-path --source legacy --yes --json
notes storage migrate-legacy-path --source nested --dry-run --json
notes storage migrate-legacy-path --source server-nested --dry-run --json
```

The `server-nested` source is `~/.hasna/apps/notes-server`. Stop `notes-serve`
before copying SQLite data; transient SQLite `-shm` files are skipped.

The explicit migration is copy-only. Planning scans regular files, rejects
symlinks, hashes existing destinations, and reports conflicts without copying.
Apply refuses any conflict, uses exclusive copies, verifies content, preserves
the source, and writes an owner-only receipt. A completed migration is
idempotent.

## Wire compatibility

Both server backends retain the `personalnotes/v1` paths and JSON shapes. That
wire name is shared with the separate `hasna-products/personalnotes` product and
must not be renamed.
