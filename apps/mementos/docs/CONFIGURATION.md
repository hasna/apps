# Configuration and storage

Mementos has three effective backends:

| Backend | Selected by | Authority |
| --- | --- | --- |
| `local-sqlite` | Explicit opt-in: `HASNA_MEMENTOS_DB_PATH` / `MEMENTOS_DB_PATH` (or `HASNA_MEMENTOS_LOCAL=1` with nothing configured) | SQLite file on this machine |
| `cloud-api` | A resolved `@hasna/contracts` credential on a client | Authenticated HTTP service |
| `cloud-postgres` | `HASNA_MEMENTOS_DATABASE_URL` inside `mementos-serve` | PostgreSQL/RDS-compatible database |

There are no deployment modes (owner directive 2026-07-29; knowledge
k_ms5wv466_u0jidq). The client transport is decided by what the
`@hasna/contracts` credential chain RESOLVES against the deliberate local
opt-ins; the server data backend by `HASNA_MEMENTOS_DATABASE_URL` presence.
The retired storage-mode variables (`HASNA_MEMENTOS_STORAGE_MODE` and aliases)
are inert — nothing reads them, and they must simply be deleted from old
environments.

Run this before a write when there is any doubt:

```bash
mementos storage mode --json
```

The transport probe uses environment/config resolution only. It does not open
SQLite, contact HTTP/PostgreSQL, or print a secret value.

## Local SQLite

The live database resolver in `src/db/database.ts` chooses a path in this order:

1. `HASNA_MEMENTOS_DB_PATH`, then `MEMENTOS_DB_PATH`.
2. The nearest existing `.mementos/mementos.db` walking upward from the current
   directory (excluding the old home-level file).
3. `<git-root>/.mementos/mementos.db` when `MEMENTOS_DB_SCOPE=project` and no
   nearer file exists.
4. `~/.hasna/mementos/mementos.db`.

An explicit database path passed to the library always selects SQLite, including
in tests and administrative file tooling. In-memory paths `:memory:` and
`file::memory:...` do not create directories.

If `~/.hasna/mementos` does not exist but legacy `~/.mementos` does, the legacy
directory is copied to the new location before resolving the default database.

### Local files

| Path | Purpose |
| --- | --- |
| `~/.hasna/mementos/mementos.db` | Default SQLite store |
| `~/.hasna/mementos/config.json` | Domain defaults, active-profile metadata, active model |
| `~/.hasna/mementos/storage/config.json` | PostgreSQL connection fallback fields |
| `~/.hasna/mementos/profiles/*.db` | Named profile database files |
| `~/.hasna/mementos/backups/*.db` | CLI backups |
| `~/.hasna/mementos/training/` | Reserved training-data output dir (fine-tuning protocol; consuming package moved to hasna-internal) |
| `~/.hasna/mementos/agents/<name>/` | Legacy agent sync files |
| `~/.open-sessions-registry.db` | Active-session registry used by `sessions` |

The profile commands and `MEMENTOS_PROFILE` manage profile metadata/files through
`src/lib/config.ts`. The primary runtime resolver in `src/db/database.ts`
currently does not consult the active-profile setting. Do not infer the live
store from `profile get`; use `storage mode` (and its `db_path`) before a write.

## Domain configuration

`mementos config` reads and writes `~/.hasna/mementos/config.json` and deep-merges
it over these defaults:

```json
{
  "default_scope": "private",
  "default_category": "knowledge",
  "default_importance": 5,
  "max_entries": 1000,
  "max_entries_per_scope": {
    "global": 500,
    "shared": 300,
    "private": 200,
    "working": 100
  },
  "injection": {
    "max_tokens": 500,
    "min_importance": 5,
    "categories": ["preference", "fact"],
    "refresh_interval": 5
  },
  "extraction": {
    "enabled": true,
    "min_confidence": 0.5
  },
  "sync_agents": ["claude", "codex", "gemini"],
  "auto_cleanup": {
    "enabled": true,
    "expired_check_interval": 3600,
    "unused_archive_days": 7,
    "stale_deprioritize_days": 14
  }
}
```

Use dotted keys:

```bash
mementos config
mementos config get injection.max_tokens
mementos config set injection.max_tokens 800
mementos config reset injection.max_tokens
mementos config path
```

`MEMENTOS_DEFAULT_SCOPE`, `MEMENTOS_DEFAULT_CATEGORY`, and
`MEMENTOS_DEFAULT_IMPORTANCE` override the three corresponding defaults after
the file is loaded. Invalid values are ignored.

## Client HTTP API transport

Clients (CLI, MCP server, `./sdk`) resolve their credential and service
authority through the ONE resolver in `@hasna/contracts/client`, fresh on every
call. The tiers, highest first:

| Tier | Source |
| --- | --- |
| 1 | explicit arguments (`--api-key` / `--profile`; `baseUrl` / `apiKey` in the SDK) |
| 2 | `HASNA_MEMENTOS_API_KEY_OVERRIDE`, `HASNA_PROFILE`, `HASNA_MEMENTOS_API_KEY_REF` (a secrets-vault item key, never a value) |
| 3 | macOS Keychain item `hasna.credentials.mementos.api-key` (account `HASNA_STATION` → `hostname -s` → `USER`) |
| 4 | `~/.hasna/mementos/config/credentials` (owner-only `0400`/`0600`; `HASNA_HOME` / `HASNA_CONFIG_HOME` move the root) |
| 5 | `HASNA_MEMENTOS_API_KEY` |

| Canonical variable | Purpose |
| --- | --- |
| `HASNA_MEMENTOS_API_URL` | Service origin or prefixed base URL (authority override) |
| `HASNA_MEMENTOS_API_KEY` | Bearer/API key |
| `HASNA_MEMENTOS_API_TIMEOUT` | curl timeout in seconds; default 45 |
| `HASNA_MEMENTOS_LOCAL` / `MEMENTOS_LOCAL` | Deliberate unhosted opt-in (honoured only when nothing configures an authority) |

The legacy unprefixed `MEMENTOS_API_URL` / `MEMENTOS_API_KEY` spellings survive
only as the resolver's silent alias fallback for one release; the resolver
refuses alias disagreement rather than picking one silently. The authority
defaults to the fleet gateway `https://api.hasna.com/mementos` (the client
appends `/v1`) once a credential resolves — a credential ALONE is a complete
configuration, and a URL configured without a resolvable credential is an
ERROR naming every tier consulted. Nothing configured anywhere refuses at
every store entry point (fail closed, owner ruling 2026-09-04): the on-box
SQLite store is reachable only through the explicit opt-ins above, and every
local run prints one line saying it is local on stderr.

If `HASNA_MEMENTOS_DATABASE_URL` or `MEMENTOS_DATABASE_URL` is also present,
API mode deliberately refuses to engage. Client and database transports are
mutually exclusive; remove the database URL from the client environment (the
DSN is server-only).

The synchronous CLI/domain API sends cloud requests by spawning `curl`
directly. The key is passed to curl on stdin, not argv or the child environment.
Request JSON uses a private mode-0600 temporary file which is removed after the
call. Client API mode therefore requires `curl` on `PATH`.

In `NODE_ENV=test`, non-loopback API requests are rejected unless
`MEMENTOS_ALLOW_REMOTE_API_IN_TESTS` is explicitly set. Repository tests should
use the store-isolation helpers rather than that escape hatch.

## Server PostgreSQL backend

Only `mementos-serve` calls `markServerContext()` and may construct/use a raw
PostgreSQL DSN for runtime reads and writes. Configure its environment with:

```bash
HASNA_MEMENTOS_DATABASE_URL=postgres://user:REDACTED@host:5432/mementos?sslmode=require
mementos-serve
```

The postgresql backend is selected by the URL's presence; fallback name
`MEMENTOS_DATABASE_URL` is accepted, with the canonical `HASNA_...` variable
winning. Without a URL the server uses SQLite. The retired storage-mode
variables (`HASNA_MEMENTOS_STORAGE_MODE`, `HASNA_MEMENTOS_MODE`,
`MEMENTOS_STORAGE_MODE`, `MEMENTOS_MODE`) are inert and must simply be deleted
from old environments.

The postgresql backend is pure remote: server reads and writes go directly to
PostgreSQL; there is no local SQLite cache and no raw-file synchronization.
Missing or invalid PostgreSQL configuration fails closed. Supported URLs use
`postgres://` or `postgresql://` and include a host.

Alternatively, `~/.hasna/mementos/storage/config.json` can provide:

```json
{
  "rds": {
    "host": "db.internal",
    "port": 5432,
    "username": "mementos",
    "password_env": "MEMENTOS_DATABASE_PASSWORD",
    "ssl": true
  },
  "auto_sync_interval_minutes": 0,
  "feedback_endpoint": "",
  "sync": { "schedule_minutes": 0 }
}
```

The password is read from the named environment variable. Storage status emits
only a safe summary and redacted URL. Secret-like URL query parameters and URL
passwords are redacted.

`sslmode=require` encrypts without certificate/hostname verification, matching
libpq semantics. `verify-ca` and `verify-full` enable verification. The vendored
storage kit also recognizes `PGSSLROOTCERT` for a CA bundle.

No S3 adapter exists, and storage diagnostics do not mutate AWS resources.

## Migration and compatibility sync

PostgreSQL schema migrations are in `src/db/pg-migrations.ts`. The current array
contains 36 migration blocks, tracked by zero-based array position in
`_pg_migrations`. Always rely on the command's `total_migrations` field rather
than a copied count in automation.

Dry-run validates and redacts without a network call:

```bash
mementos storage migrate --dry-run --connection-string \
  'postgres://user:REDACTED@db.example/mementos?sslmode=require' --json
```

A live run changes the remote database and is an administrative action:

```bash
mementos storage migrate --connection-string \
  'postgres://user:REDACTED@db.example/mementos?sslmode=require'
```

The explicit `--connection-string` path is the migration command's
administrative override; ordinary clients must never receive a DSN. The
migrate command is an operator verb: when no `--connection-string` is given it
also accepts the env-configured DSN (`HASNA_MEMENTOS_DATABASE_URL`, or the
storage config file) — the form the ECS one-shot migrate task runs during
deploys, where the DSN arrives from Secrets Manager exactly as it does for the
serve task. Every client DATA path (CLI/MCP/SDK reads and writes) still fails
closed on a DSN outside the serve process. Avoid putting a real credential in
shell history or logs. The `migrate-pg` command is
the legacy top-level equivalent. MCP exposes only safe migration dry-run
diagnostics through `mementos_storage_migrate_dry_run`; `migrate_pg` can perform
a live run and must be treated as a privileged mutation.

`storage push`, `storage pull`, and `storage sync` (and matching MCP tools) are
retained legacy row-copy paths. They are not used by the postgresql server
backend and are not the fleet cutover mechanism.

## Service, MCP, and integration variables

| Variable | Consumer | Behavior |
| --- | --- | --- |
| `PORT` | REST server | Bind port; wins over `--port`; default 19428 |
| `MEMENTOS_HOST` | REST server | Bind host; default `127.0.0.1` |
| `MEMENTOS_CORS_ORIGIN` | REST server | Comma-separated allowlist of origins or `host[:port]` for state-changing requests (and write-implicit GETs such as `inject` and `memories/{id}`); default `http://localhost:19428`. MUST be set to the deployment's own origin/host (e.g. `http://localhost:8080` for the docker-compose stack) or every state-changing request is refused with 403 |
| `API_KEY_SIGNING_SECRET` | REST auth | Preferred signing secret |
| `HASNA_MEMENTOS_API_SIGNING_KEY` | REST auth | App-specific signing secret fallback |
| `HASNA_API_SIGNING_KEY` | REST auth | Shared signing secret fallback |
| `MEMENTOS_API_KEY` | REST auth | Static-key fallback when signing is disabled |
| `MCP_STDIO=1` | MCP server | Select stdio instead of default HTTP |
| `MCP_HTTP_PORT` | MCP server | HTTP port; default 8867 |
| `MEMENTOS_URL` | hooks/standalone SDK | REST base URL; default `http://localhost:19428` |
| `MEMENTOS_AGENT` | hooks/connectors | Default agent identifier |
| `MEMENTOS_AUTO_INJECT=true` | auto-inject | Enable automatic channel injection |
| `MEMENTOS_AUTO_WHEN_TO_USE=true` | activation generation | Generate `when_to_use` guidance |
| `MEMENTOS_REFLECT_PROVIDER` | reflection | Default critic provider |
| `MEMENTOS_REFLECT_MODEL` | reflection | Default critic model |
| `OPEN_SESSIONS_URL` | sessions connector | Open Sessions endpoint |
| `OPEN_SESSIONS_TOKEN` | sessions connector | Open Sessions token |
| `CONVERSATIONS_API_URL` | channel/lock integrations | Conversations service; default `http://localhost:7020` |

## LLM provider variables

| Variable | Provider/features |
| --- | --- |
| `ANTHROPIC_API_KEY` | Anthropic auto-memory, profiles, procedures, reflection, tool lessons, optional LLM dedup |
| `OPENAI_API_KEY` | OpenAI auto-memory, embeddings, audio/image processing, reflection |
| `CEREBRAS_API_KEY` | Cerebras auto-memory and reflection |
| `XAI_API_KEY` | Grok auto-memory and reflection |
| `LLM_API_KEY` / `LLM_BASE_URL` | OpenAI-compatible ASMR ensemble override |

Provider auto-selection prefers Anthropic when configured, then Cerebras,
OpenAI, and Grok. The default auto-memory model is Anthropic
`claude-haiku-4-5`; runtime `auto-memory config` can override provider, model,
and minimum importance.
