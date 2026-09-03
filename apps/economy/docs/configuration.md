# Configuration and deployment

## Local data

The default data directory is `~/.hasna/economy/` and the SQLite database is `~/.hasna/economy/economy.db`. On first access, regular files in an older `~/.economy/` directory are copied when the new directory does not yet exist.

| Variable | Effect |
| --- | --- |
| `HASNA_ECONOMY_DB_PATH` | SQLite path; takes precedence over `ECONOMY_DB`. |
| `ECONOMY_DB` | Alternate SQLite path. `:memory:` is useful for tests. |
| `HASNA_ECONOMY_CONFIG_PATH` | Path to `config.json`; defaults under the data directory. |
| `ECONOMY_MACHINE_ID` | Machine identifier; otherwise Economy uses the normalized hostname. |
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

Local is the default. To route CLI and MCP data operations to a shared server, set:

```bash
export HASNA_ECONOMY_API_URL=https://economy.example.com
export HASNA_ECONOMY_API_KEY='...'
```

URL plus key is itself a cloud-mode signal. You may explicitly set `HASNA_ECONOMY_STORAGE_MODE=cloud`; `self_hosted`, `remote`, and `hybrid` are accepted deprecated aliases. The resolver also accepts `HASNA_ECONOMY_MODE`, `ECONOMY_STORAGE_MODE`, and `ECONOMY_MODE`, plus unprefixed `ECONOMY_API_URL`/`ECONOMY_API_KEY` aliases. An existing `/v1` suffix is normalized, otherwise it is appended. Cloud mode with no key or an invalid URL fails rather than reading an unintended local dataset.

In cloud-client mode, data commands use the HTTP API, and local auto-sync, explicit `economy sync`, and `economy billing sync` are skipped. Clients never need or use a Postgres DSN.

## REST server

Start the local server with either:

```bash
economy serve --port 3456
economy-serve --port 3456
```

`ECONOMY_PORT` supplies the `economy-serve` default. `ECONOMY_BIND` (or `ECONOMY_HOST`) controls the local bind host. `ECONOMY_API_TOKEN` (or `HASNA_ECONOMY_API_TOKEN`) enables the local shared-token check; send it as `Authorization: Bearer ...` or `X-Economy-Token`.

Without a local token, the current server defaults to `0.0.0.0` and API routes are unauthenticated. Set a token and an intentional bind address before exposing a local-mode server to another host.

The server serves `dashboard/dist` and falls back to its `index.html` for non-API paths when those assets exist.

## Self-hosted server

The server backend follows the database URL alone — `postgresql` when one of these is set, `sqlite` when none is:

```text
HASNA_ECONOMY_DATABASE_URL
ECONOMY_DATABASE_URL
DATABASE_URL
```

`HASNA_ECONOMY_STORAGE_MODE` (and `HASNA_ECONOMY_MODE`, `ECONOMY_STORAGE_MODE`, `ECONOMY_MODE`) no longer selects a backend: the server refuses to start and prints a migration hint. Delete it and set a DSN instead. This is server-only — the CLI/MCP client still reads the mode variable described above.

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
