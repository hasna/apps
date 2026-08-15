# HTTP Service, Client Modes, Migrations, and SDK

The package ships two HTTP data paths with different purposes:

- unversioned routes such as `/files` and `/sources` serve the on-box SQLite
  index and are retained for local peers and operators;
- `/v1/*` is the authenticated service API backed directly by PostgreSQL.

There is no SQLite/PostgreSQL replication, push/pull command, or hybrid cache.

## Shipped Executables

| Executable | Purpose |
| --- | --- |
| `files` | CLI over the local or HTTP data plane |
| `files-mcp` | MCP server over stdio or Streamable HTTP |
| `files-serve` | Local/unversioned and cloud `/v1` HTTP service |
| `files-migrate` | PostgreSQL migration ledger runner |

All four executables use Bun.

## Client Store Selection

The `files` CLI and `files-mcp` resolve one store for the process lifetime:

1. `HASNA_FILES_STORAGE_MODE=local` selects local SQLite even when API
   credentials are present.
2. `HASNA_FILES_API_URL` plus `HASNA_FILES_API_KEY` select the HTTP API store.
3. With neither configured, local SQLite is used.

API mode targets `<HASNA_FILES_API_URL>/v1`; callers may provide either the
service origin or a URL already ending in `/v1`. A requested API/cloud mode
with missing URL or key fails instead of falling back to a local database.

Local storage paths can be overridden with `HASNA_FILES_DATA_DIR` and
`HASNA_FILES_DB_PATH` (the older `FILES_DATA_DIR` and `FILES_DB_PATH` aliases
also work).

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
export HASNA_FILES_STORAGE_MODE=cloud
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
to PostgreSQL directly. `FILES_STORAGE_MODE`, `FILES_DATABASE_URL`, and
`HASNA_API_SIGNING_KEY` are supported aliases, but the `HASNA_FILES_*` names
are canonical.

For TLS, the PostgreSQL URL follows libpq `sslmode` semantics. `verify-ca` and
`verify-full` require a CA bundle from `PGSSLROOTCERT` or
`NODE_EXTRA_CA_CERTS`; the database connection fails rather than silently
downgrading verification. `files-serve` opens that connection lazily on a
`/v1` or cloud-readiness request, not when the listener starts.

## Health and Authentication

`/health` and `/version` report package version and `local` or `remote` service
mode. `/ready` is read-only: local mode returns ready immediately; cloud mode
checks PostgreSQL reachability and verifies that the migration ledger has no
pending entries.

Every `/v1` request requires an API key. Reads require `files:read`; other HTTP
methods require `files:write`. The built-in API store sends the configured key
as a bearer credential. The generated SDK sends it in `x-api-key`.

## Generated SDK

Import the OpenAPI-generated client from the SDK subpath. Its `baseUrl` must
include `/v1` because generated method paths are relative to that prefix.

```ts
import { FilesClient } from "@hasna/files/sdk";

const files = new FilesClient({
  baseUrl: "https://files.example.test/v1",
  apiKey: process.env.HASNA_FILES_API_KEY,
});

const sources = await files.listSources();
const matches = await files.listFiles({ q: "quarterly plan", limit: 20 });
```

`@hasna/files/sdk` also exports `openApiDocument` and `OPENAPI_VERSION`.
The generated client covers sources, files, tags, collections, projects,
machines, and aggregate stats as described by `src/server/openapi.ts`. The
runtime `/v1` service has additional agent, activity, feedback, conflict, and
evidence routes used by the internal store transport.

## Library Entry Points

- `@hasna/files` exports the local database and workflow APIs. Importing or
  invoking these APIs may open the local SQLite index or use cloud providers.
- `@hasna/files/sdk` is the generated HTTP client and OpenAPI document.
- `@hasna/files/path` contains only path normalization helpers.
- `@hasna/files/s3` is a caller-owned S3 object-store helper. It does not own
  tenant authorization, billing, audit, or key policy.

The path and S3 subpaths are the safe choices for runtimes that do not need the
full local database/workflow surface.
