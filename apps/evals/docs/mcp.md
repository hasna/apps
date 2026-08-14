# MCP Server

`evals-mcp` exposes eight evaluation tools over Streamable HTTP or stdio.

## Transports

Streamable HTTP is the default:

```bash
evals-mcp
# MCP endpoint: http://127.0.0.1:8862/mcp
# Health endpoint: http://127.0.0.1:8862/health
```

Options and environment variables:

| Setting | Behavior |
|---|---|
| `--http` / `MCP_HTTP=1` | Select HTTP explicitly; HTTP is already the default |
| `--port <port>` / `-p <port>` | Set the HTTP port |
| `MCP_HTTP_PORT` | Set the HTTP port when no port flag is present |
| `--stdio` / `MCP_STDIO=1` | Select stdio instead of HTTP |
| `-V, --version` | Print the package version |

Flags take precedence over the port environment variable. Ports must be integers from 1 through 65535.

## Registration

```bash
evals mcp register --claude
evals mcp register --codex
evals mcp register --gemini
evals mcp register --all
```

With no agent flag, registration selects Claude Code. The command updates the agent's JSON configuration under `~/.claude`, `~/.codex`, or `~/.gemini`; inspect existing configuration before automating registration. Restart the agent after registration.

For a manual stdio configuration, launch `evals-mcp --stdio`. HTTP clients connect to `http://127.0.0.1:8862/mcp` by default.

## Tools

### `evals_run`

Required: `dataset`, `adapter`. Optional: `concurrency`, `skip_judge`, `tags`, `save`, `output_format` (`summary`, `json`, or `markdown`), `limit`, and `verbose`. Summary output defaults to 10 result rows. Runs are only persisted when `save` is true.

### `evals_run_single`

Required: `input`, `output`, `rubric`. Optional: `expected`, `assertions`, `judge_model`, and `judge_provider`. The current handler judges the supplied output and returns `VERDICT` plus `REASONING`; the accepted `assertions` field is not executed by this tool.

### `evals_judge`

Required: `input`, `output`, `rubric`. Optional: `expected`, `model`, and `provider`. Returns the verdict and reasoning as text.

### `evals_list_datasets`

Recursively lists `.jsonl` and `.json` files under `directory` (default `./datasets`). `limit` defaults to 50 and `cursor` is a numeric pagination offset returned as text.

### `evals_get_results`

With `run_id`, returns an unambiguous saved run in `summary`, `json`, or `markdown` format. Without `run_id`, lists saved runs using `limit` (default 10) and `cursor`; `format: "json"` returns summaries plus pagination metadata. `verbose` applies to a single run's summary.

### `evals_compare`

Required: `before`, `after`. Each value may be a saved run ID/prefix or baseline name. Optional `limit` defaults to 20; `verbose` removes the compact diff limit.

### `evals_create_case`

Required: `dataset`, `id`, `input`. Optional: `expected`, `rubric`, `assertions`, and `tags`. Appends one JSONL case to the target file; `rubric` becomes `judge.rubric`.

### `evals_generate_cases`

Required: `description`. Optional: `count` (default 10), `output` (default `generated.jsonl`), and `seeds`. The current MCP handler generates with Anthropic Claude and writes lines beginning with `{`; the accepted `seeds` field is not read by the handler.

## Output sizing

MCP tools favor compact text. Use `limit`/`cursor` for discovery, `verbose: true` for complete human-readable result rows, and JSON formats only when a complete machine-readable object is needed.
