# Hasna Notes

`@hasna/notes` is a headless Notes package: an authenticated HTTPS CLI, MCP
server, SDK, and a PostgreSQL-only `personalnotes/v1` server. Client processes
never open a database directly.

> There is no desktop app in this package. The separate macOS product remains
> [hasna-products/personalnotes](https://github.com/hasna-products/personalnotes).
> The existing `personalnotes/v1` wire name is a compatibility contract and is
> intentionally not renamed.

## Canonical client contract

The CLI, MCP server, and `@hasna/notes/sdk` all resolve their authority and
credential through the single fleet resolver in `@hasna/contracts`
(hasna/apps#1720), per request, fresh — a long-lived MCP server or SDK client
picks up a key rotation without a restart. The `personalnotes/v1` wire dialect
is spoken at the `/v1` authority root. There is no local SQLite/Markdown
fallback and no default localhost endpoint.

### Environment variables

| Variable | Role | Notes |
|---|---|---|
| `HASNA_NOTES_API_URL` | service authority | Optional; overrides the Keychain `api-url` item, the credentials file, and the default fleet gateway `https://api.hasna.com/notes`. Must be absolute HTTPS (exact loopback HTTP is allowed for local dev). |
| `HASNA_NOTES_API_KEY` | API key | The bottom tier of the credential chain, read per call. Keychain and disk run first (see below). |
| `HASNA_NOTES_API_KEY_OVERRIDE` | deliberate per-call key | Never auto-populated; outranks every other tier and never falls through. |
| `HASNA_PROFILE` | identity selection | Selects `credentials-<profile>` beside the credentials file. |
| `HASNA_NOTES_API_KEY_REF` | secrets-vault pointer | Names a vault ITEM KEY (`namespace/app/live/api_key`), resolved through the secrets SDK at request time; terminal on failure. |
| `HASNA_HOME` / `HASNA_CONFIG_HOME` | layout overrides | Replace `~/.hasna` / the config root; blank or relative values are ignored. |
| `HASNA_NOTES_DATABASE_URL` | **server-only** | A client process that contains it fails closed; client status and errors never print credentials. PostgreSQL migration scripts and `notes-serve` remain the only DSN consumers. |

### Credential and authority chain

The CLI, MCP server, and `./sdk` use the same resolver; every request walks the
chain again:

1. keychain: macOS item `hasna.credentials.notes.api-key` (account
   `HASNA_STATION`, else the short hostname, else `USER`);
2. disk: `~/.hasna/notes/config/credentials` (owner-only `0600`, re-read on
   every call);
3. env: `HASNA_NOTES_API_KEY`.

The authority follows the same ladder — `HASNA_NOTES_API_URL`, the Keychain
`api-url` item, the credentials file — and defaults to the fleet gateway
`https://api.hasna.com/notes` once a credential resolves, so a key alone is a
complete configuration.

Hosted with no credential FAILS CLOSED on every surface: non-zero exit, no
SQLite, no local-fallback event, and the refusal names every tier it
consulted. An explicit base URL without an explicit key is also refused — the
ambient fleet credential is never attached to an arbitrary authority
(hasna/apps#1794). Authenticated requests reject every HTTP redirect instead
of forwarding an API key/body or accepting method-rewritten 301/302/303
responses as success. A 401/403 response body is cancelled unread.

Supported CLI operations are `list`, `get`, `create`, `update`, `delete`,
`archive`, `restore`, label assignment, and Markdown helpers. Run `notes --help`
for the exact surface. `notes-mcp` exposes the same remote-safe operations over
stdio. Destructive deletion is confirmation-gated.

```js
import { NotesClient } from '@hasna/notes/sdk';

const notes = new NotesClient(); // resolves per request: Keychain → credentials file → env
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
