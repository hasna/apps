# Configuration and deployment

## Local data

The default data directory is `~/.hasna/economy/` and the SQLite database is `~/.hasna/economy/economy.db`. On first access, regular files in an older `~/.economy/` directory are copied when the new directory does not yet exist.

| Variable | Effect |
| --- | --- |
| `HASNA_ECONOMY_DB_PATH` | SQLite path; takes precedence over `ECONOMY_DB`. |
| `ECONOMY_DB` | Alternate SQLite path. `:memory:` is useful for tests. |
| `HASNA_ECONOMY_CONFIG_PATH` | Path to `config.json`; defaults under the data directory. |
| `HASNA_ECONOMY_MACHINE_ID` | Machine identifier; otherwise Economy uses the normalized hostname. |
| `ECONOMY_TAG` | Fallback attribution tag on locally written sessions/requests. |

`economy config` reads and writes `config.json`. The defaults are `port=3456`, `default-period=today`, `auto-sync=true`, `sync-interval=30`, `alert-thresholds=[5,10,25,50,100]`, and `webhook-url=null`. At present, `webhook-url` drives budget notifications and `activeModel` records the selected model used by AI analysis; the other stored values are compatibility/settings metadata. Binary ports, periods, and watch intervals still come from command options or the environment described below.

## Account attribution

For an agent token such as `CODEX`, Economy checks these explicit forms before consulting `@hasna/accounts`:

```text
ECONOMY_CODEX_ACCOUNT_KEY or ECONOMY_CODEX_ACCOUNT
ECONOMY_ACCOUNT_KEY       or ECONOMY_ACCOUNT
```

Values may be `tool:name` (for example `codex:work`) or a bare name/email. The structured form is:

```text
ECONOMY_CODEX_ACCOUNT_TOOL / _NAME / _EMAIL
ECONOMY_ACCOUNT_TOOL       / _NAME / _EMAIL
```

The same agent-specific pattern applies to all eight supported agents. Account keys use the tool plus normalized email when available, otherwise the profile name.

## CLI/MCP cloud client

The CLI and MCP server resolve their credential through the `@hasna/contracts` 1.0.2 client resolver, FRESH ON EVERY CALL (and per request inside a long-lived MCP server, so a key rotation heals without a restart). The tiers, in order:

1. an explicit `--api-key` / `--profile` argument (CLI flags only)
2. a deliberate env pointer — `HASNA_ECONOMY_API_KEY_OVERRIDE`, `HASNA_PROFILE`, `HASNA_ECONOMY_API_KEY_REF`
3. the macOS Keychain — item `hasna.credentials.economy.api-key`, account `HASNA_STATION` → `hostname -s` → `$USER`
4. disk — `~/.hasna/economy/config/credentials` (0600, `HASNA_ECONOMY_API_KEY=…`; `HASNA_HOME` / `HASNA_CONFIG_HOME` move the root; XDG locations are never read)
5. `HASNA_ECONOMY_API_KEY` in the environment — legitimate, no deprecation notice

The authority follows the same ladder — `HASNA_ECONOMY_API_URL`, the Keychain `api-url` item, the credentials file — and DEFAULTS to the fleet gateway `https://api.hasna.com/economy` once a credential resolves, so a key alone is a complete configuration. An existing `/v1` suffix is normalized, otherwise it is appended. The unprefixed `ECONOMY_API_URL` / `ECONOMY_API_KEY` spellings are legacy aliases, accepted for one release at lower precedence.

**Fail closed (owner directive 2026-09-04).** A run without a credential from any tier exits non-zero, creates no SQLite file, and emits no `economy-local-fallback` event: an unconfigured client refuses to guess which dataset it serves. The error names every tier consulted.

**Local mode (the on-box SQLite store) is reachable only by explicit opt-in:**

```bash
export HASNA_ECONOMY_LOCAL=1
```

The unprefixed `ECONOMY_LOCAL=1` alias is accepted. The opt-in yields to every hosted signal (a URL, a key, or a pointer in the environment outranks it), and a local run prints one line on stderr — `economy: local mode (HASNA_ECONOMY_LOCAL=1) …` — so an unhosted run is never mistaken for a hosted one that came back empty.

Retired `*_STORAGE_MODE` / `*_MODE` variables no longer exist as selectors: `HASNA_ECONOMY_STORAGE_MODE` (and `HASNA_ECONOMY_MODE`, `ECONOMY_STORAGE_MODE`, `ECONOMY_MODE`, plus the accounts variants `HASNA_ACCOUNTS_*_MODE`) are a hard error on the client — delete them and let the resolved credential do the routing.

In cloud-client mode, data commands use the HTTP API, and local auto-sync, explicit `economy sync`, and `economy billing sync` are skipped. Clients never need or use a Postgres DSN.

## REST server

Start the local server with either:

```bash
economy serve --port 3456
economy-serve --port 3456
```

`ECONOMY_PORT` supplies the `economy-serve` default. `ECONOMY_BIND` (or `ECONOMY_HOST`) controls the local bind host. `HASNA_ECONOMY_API_TOKEN` enables the local shared-token check; send it as `Authorization: Bearer ...` or `X-Economy-Token`. (The unprefixed `ECONOMY_API_TOKEN` spelling is retired.)

Without a local token, the current server defaults to `0.0.0.0` and API routes are unauthenticated. Set a token and an intentional bind address before exposing a local-mode server to another host.

## Self-hosted server

The server backend follows the database URL alone — `postgresql` when one of these is set, `sqlite` when none is:

```text
HASNA_ECONOMY_DATABASE_URL
ECONOMY_DATABASE_URL
DATABASE_URL
```

`HASNA_ECONOMY_STORAGE_MODE` (and `HASNA_ECONOMY_MODE`, `ECONOMY_STORAGE_MODE`, `ECONOMY_MODE`) no longer selects a backend: the server refuses to start and prints a migration hint. Delete it and set a DSN instead. The client follows the same rule — the variables are a hard error there too, and API routing comes from the URL + key pair above.

Apply migrations with `economy-serve migrate`. `ECONOMY_PG_POOL_MAX` defaults to 5. A non-loopback server also requires one of `HASNA_ECONOMY_API_SIGNING_KEY`, `HASNA_API_SIGNING_KEY`, or `API_KEY_SIGNING_SECRET`; API keys are then verified by `@hasna/contracts`. The signing secret belongs only on the server.

See [REST API authentication](rest-api.md#authentication) for request headers and open probes.

## Other services

| Variable | Effect |
| --- | --- |
| `MCP_HTTP=1` | Run `economy-mcp` in Streamable HTTP mode instead of stdio. |
| `MCP_HTTP_PORT` | MCP HTTP port; default 8860 and overridden by `--port`. |
| `ECONOMY_OTEL_PORT` | OTLP sidecar port; default 4318 and overridden by `--port`. |
| `ECONOMY_OTEL_BIND` | OTLP sidecar bind host; default `127.0.0.1`. |

Source- and billing-specific environment variables are listed in [Ingestion](ingestion.md).
