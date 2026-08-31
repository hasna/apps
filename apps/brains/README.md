# @hasna/brains

Fine-tuned model tracker and trainer — wraps OpenAI + Tinker, gathers training data from todos/mementos/conversations/sessions

[![npm](https://img.shields.io/npm/v/@hasna/brains)](https://www.npmjs.com/package/@hasna/brains)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/brains
```

## CLI Usage

```bash
brains --help
```

### Provider rename migration

The fine-tuning provider formerly named "Thinker Labs" is now "Tinker". To
migrate an existing configuration:

- `brains config set TINKER_API_KEY <key>` (previously `THINKER_LABS_API_KEY`)
- `brains config set TINKER_BASE_URL <url>` (previously `THINKER_LABS_BASE_URL`)
- use `--provider tinker` (previously `thinker-labs`)

The legacy provider spelling `thinker-labs` and the legacy
`THINKER_LABS_API_KEY` / `THINKER_LABS_BASE_URL` env vars remain accepted for
backwards compatibility and are normalized to `tinker` / `TINKER_*` at the
CLI, MCP, and schema boundaries; persisted rows that stored `thinker-labs`
keep working.

- `brains models list`
- `brains models show`
- `brains finetune start`
- `brains finetune status`
- `brains data`

### Compact Output Defaults

Human CLI output is compact by default so agent terminals do not fill with large
records. List and status-style commands show the essential fields, cap displayed
rows, truncate long text and paths, and print a hint for the next detail command
or flag.

Use these disclosure controls when you need more:

```bash
brains models list --limit 50
brains models list --verbose
brains models show <id>
brains data preview ./dataset.jsonl --verbose
brains data preview ./dataset.jsonl --json
```

- `--limit <n>` increases the number of human rows shown where supported.
- `--verbose` keeps human output readable while showing fuller fields.
- `show` commands are the detail path for one record.
- `--json` returns machine-readable records and preserves full underlying data
  unless a limiting flag is explicitly supplied.

MCP list/preview tools follow the same rule: compact summaries by default, with
`limit` and `verbose` inputs for larger or fuller responses.

## MCP Server

```bash
brains-mcp
```

## HTTP mode

Run a long-lived Streamable HTTP MCP server on `127.0.0.1` (default port **8802**):

```bash
brains-mcp --http
# or: MCP_HTTP=1 brains-mcp
# port override: --port 8802  or  MCP_HTTP_PORT=8802
```

- Health: `GET http://127.0.0.1:8802/health` → `{"status":"ok","name":"brains"}`
- MCP: `http://127.0.0.1:8802/mcp`

Stdio remains the default when no `--http` / `MCP_HTTP=1` is set.

## REST API

```bash
brains-serve
```

## Storage Sync

This package supports package-native local/remote storage sync:

```bash
brains storage status
brains storage push
brains storage pull
```

Set `HASNA_BRAINS_DATABASE_URL` for a direct PostgreSQL connection, or configure the
storage config file at the resolver-resolved brains data home (`storage/config.json`
under the effective data home — the legacy `~/.hasna/brains` default until the XDG
data home is adopted) with `postgres` host settings. Legacy cloud aliases are not
used. Configure remote storage with the storage environment variables above.

## Data Directory

The brains data home is resolved through `@hasna/paths` (XDG/macOS home layout).
The legacy `~/.hasna/brains` default stays the effective data home until the store
is actually migrated to the XDG data home (`~/.local/share/hasna/brains` on Linux;
`~/Library/Application Support/Hasna/brains` on macOS) or the operator sets the
data-kind override `HASNA_DATA_HOME`, so an existing local store never becomes
invisible on upgrade. Exact-app overrides win over that default:
`HASNA_BRAINS_DIR`, then the fallback `HASNA_BRAINS_HOME`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
