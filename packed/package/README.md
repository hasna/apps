# Hasna Notes

`@hasna/notes` is a headless Notes package: an authenticated HTTPS CLI, MCP
server, SDK, and a PostgreSQL-only `personalnotes/v1` server. Client processes
never open a database directly.

> There is no desktop app in this package. The separate macOS product remains
> [hasna-products/personalnotes](https://github.com/hasna-products/personalnotes).
> The existing `personalnotes/v1` wire name is a compatibility contract and is
> intentionally not renamed.

## Canonical client contract

The CLI, MCP server, and `@hasna/notes/sdk` all use the single resolver in
`client/transport.mjs`. Every client invocation that accesses notes requires:

```sh
export HASNA_NOTES_API_URL=https://notes.example.com
export HASNA_NOTES_API_KEY='...'
notes list --json
```

Both variables are required. The URL must be absolute HTTPS and cannot contain
credentials, a query, or a fragment. Partial or missing configuration fails
closed before any note data is read or written. There is no local
SQLite/Markdown fallback and no default localhost endpoint.
Authenticated requests reject every HTTP redirect instead of forwarding an API
key/body or accepting method-rewritten 301/302/303 responses as success.

`HASNA_NOTES_DATABASE_URL` is server-only. A client process that contains it
fails closed; client status and errors never print credentials. PostgreSQL
migration scripts and `notes-serve` remain the only DSN consumers.

Supported CLI operations are `list`, `get`, `create`, `update`, `delete`,
`archive`, `restore`, label assignment, and Markdown helpers. Run `notes --help`
for the exact surface. `notes-mcp` exposes the same remote-safe operations over
stdio. Destructive deletion is confirmation-gated.

```js
import { NotesClient } from '@hasna/notes/sdk';

const notes = new NotesClient();
const page = await notes.list({ limit: 10 });
```

The package root exports the same authenticated remote client as `./sdk`.
Pure Markdown/frontmatter formatting helpers are available only at
`@hasna/notes/compat/markdown-format`; that subpath exports no local CRUD.

## Data paths and explicit migration

Maintenance data paths resolve through the in-package XDG resolver (the
former `@hasna/paths` contract, kept in-package after that package was
retired). Without an exact app override, the destination is the platform XDG
data location, for example `$XDG_DATA_HOME/hasna/notes` on Linux or
`~/Library/Application Support/Hasna/notes` on macOS. Exact overrides retain
their precedence: `HASNA_NOTES_HOME`, `HASNA_NOTES_ROOT`, then `NOTES_HOME`.

Legacy roots are never selected or copied implicitly. Review a copy-only plan,
then apply it explicitly:

```sh
notes storage migrate-legacy-path --source legacy --dry-run --json
notes storage migrate-legacy-path --source legacy --yes --plan-fingerprint <reviewed-hash> --json
notes storage migrate-legacy-path --source nested --dry-run --json
notes storage migrate-legacy-path --source server-nested --dry-run --json
```

`legacy` means `~/.hasna/notes`; `nested` means `~/.hasna/apps/notes`; and
`server-nested` means `~/.hasna/apps/notes-server`. Stop all legacy writers before copying archived SQLite/Markdown data. SQLite `-shm` files are deliberately skipped.
The dry-run returns a fingerprint; apply requires that unchanged fingerprint.
Migration stages at most 256 MiB of reviewed bytes before copying, rejects
symlinks in every path component (use canonical absolute paths), and
rejects symlinks and destination conflicts, never overwrites a file, verifies
each copy, preserves the source, and writes an owner-only receipt. It is safe to
re-run after a successful copy using a fresh dry-run. Existing receipts are never
overwritten. Interrupted copies are preserved for inspection; there is no
automatic deletion rollback. This command only preserves offline import material:
it does not import records into PostgreSQL or enable local CRUD.

## Self-hosted server

`notes-serve` implements the existing `personalnotes/v1` CRUD, auth, export,
health, readiness, version, and OpenAPI surfaces. A valid server-only
`HASNA_NOTES_DATABASE_URL` is mandatory; missing/invalid configuration fails
before listening. `--db` and `HASNA_NOTES_SERVER_DB` are removed. SQLite exists
only in unshipped, explicitly injected dialect-test fixtures.

```sh
# Inject server DSN and signing key through the approved runtime secret mechanism.
bun server/index.mjs --port 8788
```

The server listens over HTTP locally. Canonical clients require an HTTPS URL,
so put TLS termination in front of it even for a self-hosted client path.
Database migrations are server operations:

```sh
HASNA_NOTES_DATABASE_URL_OWNER=<owner-dsn> \
  bun scripts/apply-postgres-migrations.mjs --dry-run --json
NOTES_TEST_DATABASE_URL=<throwaway-dsn> bun run test:pg
```

Inject DSNs through the runtime credential mechanism; never place them in
source, command history, logs, or client environments.

## Development

```sh
bun install --frozen-lockfile
cd apps/notes
bun test
bun run scan:artifact
bun run pack:dry
```

See [storage.md](docs/storage.md) for storage boundaries,
[sync.md](docs/sync.md) for the single-server model, and
[notes-vs-personalnotes.md](docs/notes-vs-personalnotes.md) for the product and
wire-compatibility boundary.
