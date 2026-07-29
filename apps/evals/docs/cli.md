# CLI Reference

The `evals` executable uses Commander. Run `evals --help` or `evals <command> --help` for generated help from the installed version. This page covers the built-in commands in this repository; `@hasna/events` may append event-related commands at runtime.

## Global options

| Option | Behavior |
|---|---|
| `-V, --version` | Print the package version |
| `-h, --help` | Print help |

## `evals run <dataset>`

Loads a JSONL/JSON dataset or glob, runs it against one adapter, and exits `1` when any result fails or errors. Runs are only persisted with `--save`.

| Option | Default | Behavior |
|---|---:|---|
| `--adapter <type>` | `http` | `http`, `anthropic`, `openai`, `mcp`, `function`, or `cli` |
| `--url <url>` | — | HTTP endpoint or OpenAI-compatible base URL |
| `--method <method>` | `POST` | HTTP `GET`, `POST`, `PUT`, or `PATCH` |
| `--headers <json>` | — | JSON object whose values must be strings |
| `--response-mode <mode>` | `json` | HTTP response parser: `json` or `text` |
| `--input-path <path>` | — | Dot path where the HTTP input is written |
| `--output-path <path>` | auto | Dot path read from an HTTP JSON response |
| `--timeout-ms <n>` | adapter-specific | Positive adapter timeout in milliseconds |
| `--model <model>` | — | Required for Anthropic and OpenAI adapters |
| `--max-tokens <n>` | provider default | Positive maximum output tokens for model adapters |
| `--api-key <key>` | provider environment | Provider API key override |
| `--api-key-env <name>` | — | Read the provider API key from a named environment variable |
| `--base-url <url>` | — | OpenAI-compatible base URL |
| `--system <prompt>` | — | Anthropic/OpenAI system prompt |
| `--module <path>` | — | Required function-adapter module |
| `--export <name>` | `default` | Function-adapter export |
| `--command <cmd>` | — | Required CLI-adapter command; supports `{{input}}` |
| `--mcp-command <cmd>` | — | Required MCP server command, split on spaces |
| `--tool <name>` | — | Required MCP tool name |
| `--concurrency <n>` | `5` | Number of cases in each parallel batch |
| `--repeat <n>` | `1` | Run each case repeatedly unless the case defines `repeat` |
| `--tags <tags>` | — | Comma-separated tag filter; matching is OR |
| `--no-judge` | false | Skip configured LLM judges and run assertions only |
| `--output <format>` | `terminal` | `terminal`, `json`, or `markdown` |
| `--save` | false | Save the run in the local SQLite store |
| `--limit <n>` | `20` | Compact terminal row limit |
| `--verbose` | false | Show every terminal result row |
| `-j, --json` | false | Alias for `--output json` |

## `evals ci`

### `evals ci run <dataset>`

Runs and always saves the dataset, then compares it with a named baseline. Adapter options match `evals run` except this command has no `--concurrency`, `--repeat`, `--tags`, or `--save` options.

| Option | Default | Behavior |
|---|---:|---|
| `--baseline <name>` | `main` | Baseline to compare |
| `--fail-if-regression <pct>` | `0` | Exit `1` when pass-rate drop exceeds this percentage |
| `--output <format>` | `terminal` | `terminal` or `markdown` |
| `--limit <n>` | `20` | Compact run/diff row limit |
| `--verbose` | false | Show all run/diff rows |
| `-j, --json` | false | Print the full run as JSON |

It also exits `1` when the new run contains failed cases. Adapter setup and validation options are listed under `evals run`.

### `evals ci set-baseline <name>`

Sets a named baseline to `--run-id <id>` or, when omitted, the most recently saved run. It exits `1` when no saved run exists.

## Run history

### `evals runs list`

| Option | Default | Behavior |
|---|---:|---|
| `--limit <n>` | `20` | Maximum saved runs returned |
| `--cursor <n>` | `0` | Non-negative pagination offset |
| `--dataset <path>` | — | Exact dataset-path filter |
| `-j, --json` | false | Compact JSON summaries and pagination metadata |

### `evals runs show <id>` / `evals runs inspect <id>`

Both commands accept a full run ID or an unambiguous prefix.

| Option | Default | Behavior |
|---|---:|---|
| `--limit <n>` | `20` | Compact result row limit |
| `--verbose` | false | Show all human-readable rows |
| `--markdown` | false | Print a complete Markdown report |
| `-j, --json` | false | Print the full run JSON |

## Comparison and judging

### `evals compare <before> <after>`

`before` accepts a run ID/prefix or baseline name. `after` also accepts `latest`. The command exits `1` when regressions are present.

Options: `-j, --json`, `--markdown`, `--limit <n>` (default `20`), and `--verbose`.

### `evals judge`

Required options are `--input <text>`, `--output <text>`, and `--rubric <text>`. Optional flags are `--expected <text>`, `--model <model>` (default `claude-sonnet-4-6`), `--provider <anthropic|openai>` (default `anthropic`), and `-j, --json`. A `FAIL` verdict exits `1`; `PASS` and `UNKNOWN` exit `0`.

### `evals calibrate <gold>`

Loads cases with `metadata.gold_verdict`, judges each case's input against its `expected` text, and reports agreement plus Cohen's kappa.

Options: `--model <model>`, `--provider <anthropic|openai>`, `--limit <n>` (default `20`), `--verbose`, and `--json`.

## Dataset utilities

### `evals estimate <dataset>`

Estimates judge calls using 800 tokens per judged case without making provider calls. Options: `--model <model>`, `--no-judge`, and `-j, --json`.

### `evals generate`

Requires `--description <text>`. It asks Anthropic Claude for JSONL and writes valid cases to `--output <path>`.

Options: `--seeds <path>`, `--count <n>` (default `10`), `--output <path>` (default `generated.jsonl`), `--model <model>`, and `-j, --json`.

### `evals capture`

Requires `--app <url>` and starts a local reverse proxy. The output file is truncated at startup. JSON request/response samples are appended as staging cases.

Options: `--port <n>` (default `19441`), `--rate <n>` (default `0.1`), and `--output <path>` (default `captured.jsonl`). Route client traffic through `http://localhost:<port>` while capture is running.

## Operations

### `evals doctor`

Checks Anthropic/OpenAI keys, local database access, and example-dataset availability. Use `-j, --json` for machine-readable output. The OpenAI key and example dataset are optional; required-check failures exit `1`.

### `evals completion <shell>`

Prints a completion script for `bash` or `zsh`; any other shell exits `1`.

### `evals mcp register`

Registers `evals-mcp` for Claude Code, Codex, Gemini, or all three with `--claude`, `--codex`, `--gemini`, or `--all`. With no flag, it selects Claude Code.

### `evals mcp start`

Starts `evals-mcp` in its default Streamable HTTP mode. See [MCP server](mcp.md) for transport options and endpoints.
