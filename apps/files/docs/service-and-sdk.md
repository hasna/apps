# HTTP Service, Client Transports, Migrations, and SDK

The package ships two HTTP data paths with different purposes:

- unversioned routes such as `/files` and `/sources` serve the on-box SQLite
  index and are retained for local peers and operators;
- `/v1/*` is the authenticated service API backed directly by PostgreSQL.

There is no SQLite/PostgreSQL replication or push/pull command.

## Shipped Executables

| Executable | Purpose |
| --- | --- |
| `files` | CLI over the local or HTTP data plane |
| `files-mcp` | MCP server over stdio or Streamable HTTP |
| `files-serve` | Local/unversioned and PostgreSQL-backed `/v1` HTTP service |
| `files-migrate` | PostgreSQL migration ledger runner |

All four executables use Bun.

## Client Store Selection

The `files` CLI, `files-mcp` and the `./sdk` client resolve the transport
FRESH ON EVERY CALL through the ONE `@hasna/contracts` credential chain
(hasna/apps#1720) — a long-lived shell, MCP server or agent loop picks up a
key rotation without a restart:

1. The chain supplies the hosted API key: an explicit `--api-key`/`--profile`
   argument, then `HASNA_FILES_API_KEY_OVERRIDE` / `HASNA_PROFILE` /
   `HASNA_FILES_API_KEY_REF`, then the macOS Keychain item
   `hasna.credentials.files.api-key`, then `~/.hasna/files/config/credentials`
   (owner-only 0400/0600), then `HASNA_FILES_API_KEY` — and with it the
   hosted HTTP API store.
2. With no resolvable credential, the CLI and MCP server **fail closed**: they
   exit non-zero naming every tier the resolver consulted. Local SQLite is
   used **only** under the explicit opt-in `HASNA_FILES_LOCAL=1` (alias
   `FILES_LOCAL=1`) — local mode is never a default, an unconfigured run never
   creates `~/.hasna/files/files.db` or reports a false-green local session,
   and every local run prints one `files: LOCAL mode — ...` line on stderr.
3. A credential with no explicit URL is complete: the authority defaults to
   the fleet gateway `https://api.hasna.com/files`. An explicit URL without a
   resolvable key is a misconfiguration and fails closed instead of falling
   back to a local database.

The authority follows `HASNA_FILES_API_URL`, the Keychain `api-url` item, and
the credentials file; the hosted API targets `<authority>/v1`. Local storage
paths can be overridden with `HASNA_FILES_DATA_DIR` and `HASNA_FILES_DB_PATH`
(the older `FILES_DATA_DIR` and `FILES_DB_PATH` aliases also work).

Retired everywhere: the `HASNA_FILES_LOCAL_MODE` / `FILES_LOCAL_MODE` /
`*_STORAGE_MODE` switches, `~/.hasna/fleet-env`, `~/.hasna/cloud`,
`~/.config/hasna`, `$XDG_CONFIG_HOME`, any `~/.files/config.json` key store,
and the legacy-env DEPRECATED stderr notices.

## Local Service

```bash
files-serve --port 19432
```

The default bind host is `127.0.0.1`; override it with
`OPEN_FILES_REST_HOST` (or `FILES_REST_HOST`). If the requested port is in use,
the launcher probes up to 99 subsequent ports. In local mode the launcher also
starts non-blocking indexing for enabled local sources and schedules configured
auto-sync peers.

The following endpoints do not require `/v1` API-key authentication:

- `GET /health`, `GET /ready`, `GET /version`
- local resources under `/sources`, `/files`, `/tags`, `/collections`,
  `/projects`, `/machines`, `/agents`, `/evidence`, and `/stats`
- peer synchronization under `POST /sync`

Unsafe unversioned routes are denied unless their capability is enabled. Use
`OPEN_FILES_REST_ALLOW_<CAPABILITY>=1`,
`OPEN_FILES_ALLOW_<CAPABILITY>=1`, `OPEN_FILES_REST_ALLOW_ALL=1`, or
`OPEN_FILES_ALLOW_ALL=1`. The route capabilities are `mutations`,
`destructive`, `imports`, `signed_urls`, `downloads`, and `indexing`.

Browser origins are rejected unless they are same-origin or exactly listed in
the comma-separated `OPEN_FILES_REST_ALLOWED_ORIGINS` value. The legacy alias
is `OPEN_FILES_REST_ALLOW_ORIGINS`. `OPEN_FILES_REST_ALLOW_ANY_ORIGIN=1` is an
explicit opt-out and should be reserved for controlled deployments.

## PostgreSQL-Backed Service

Configure the service and migration runner with:

```bash
export HASNA_FILES_DATABASE_URL='postgresql://...'
export HASNA_FILES_API_SIGNING_KEY='<signing-secret>'

files-migrate --check
files-migrate
files-serve --port 19432
```

`files-migrate --check` and `--dry-run` are aliases. They connect to the
configured database, report pending migrations, do not apply them, and exit 1
when migrations are pending. Running `files-migrate` without either flag
applies the ordered migrations through the checksum-protected ledger.
Both check modes ensure that the `schema_migrations` ledger table exists, so a
first check against a new database still requires permission to create it.

`HASNA_FILES_DATABASE_URL` is service-only. CLI and MCP clients never connect
to PostgreSQL directly. `FILES_DATABASE_URL` and `HASNA_API_SIGNING_KEY` are
supported aliases, but the `HASNA_FILES_*` names are canonical.

For TLS, the PostgreSQL URL follows libpq `sslmode` semantics. `verify-ca` and
`verify-full` require a CA bundle from `PGSSLROOTCERT` or
`NODE_EXTRA_CA_CERTS`; the database connection fails rather than silently
downgrading verification. `files-serve` opens that connection lazily on a
`/v1` or readiness request, not when the listener starts.

## Health and Authentication

`/health` and `/version` report package version and the storage backend
(`sqlite` or `postgres`). `/ready` is read-only: the SQLite backend returns
ready immediately; the Postgres backend checks PostgreSQL reachability and
verifies that the migration ledger has no pending entries.

Every `/v1` request requires an API key. Reads require `files:read`; other HTTP
methods require `files:write`. The built-in API store sends the configured key
as a bearer credential. The generated SDK sends it in `x-api-key`.

## Generated SDK

Import the OpenAPI-generated client from the SDK subpath. Its `baseUrl` must
include `/v1` because generated method paths are relative to that prefix.

The resolver-backed factory `createFilesClientFromEnv` builds a client whose
credential and authority come from the SAME `@hasna/contracts` chain the CLI
and MCP server use — resolved fresh on EVERY request, so a client held for
hours picks up a rotation without being rebuilt. Throws when no credential
resolves; the SDK never reads local data.

```ts
import { createFilesClientFromEnv } from "@hasna/files/sdk";

// Credential + authority from the @hasna/contracts chain (Keychain, disk
// credential file, HASNA_FILES_API_KEY; fleet gateway default authority).
const files = createFilesClientFromEnv();
const sources = await files.listSources();

// A caller-pinned authority: an explicit baseUrl with an apiKey is a
// deliberate pin; a baseUrl WITHOUT an apiKey never receives the ambient
// fleet key (it is an unauthenticated client for that authority).
const selfHosted = createFilesClientFromEnv(undefined, {
  baseUrl: "https://files.example.test",
  apiKey: process.env.HASNA_FILES_API_KEY,
});
```

`resolveFilesSdkTransport(env)` reports which tier and source supplied the
credential (never the value) and the resolved `<origin>/v1` base.

`@hasna/files/sdk` also exports `FILES_APP_NAME`, `openApiDocument` and
`OPENAPI_VERSION`. The generated client covers sources, files, tags,
collections, projects, machines, and aggregate stats as described by
`src/server/openapi.ts`. The runtime `/v1` service has additional agent,
activity, feedback, conflict, and evidence routes used by the internal store
transport.

## Library Entry Points

- `@hasna/files` exports the local database and workflow APIs. Importing or
  invoking these APIs may open the local SQLite index or use cloud providers.
- `@hasna/files/sdk` is the generated HTTP client and OpenAPI document.
- `@hasna/files/path` contains only path normalization helpers.
- `@hasna/files/s3` is a caller-owned S3 object-store helper. It does not own
  tenant authorization, billing, audit, or key policy.

The path and S3 subpaths are the safe choices for runtimes that do not need the
full local database/workflow surface.
