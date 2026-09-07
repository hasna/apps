# CLI reference

Installing `@hasna/economy` provides four binaries:

| Binary | Purpose |
| --- | --- |
| `economy` | Ingest, query, and manage Economy data. |
| `economy-mcp` | Run the MCP server over stdio or Streamable HTTP. |
| `economy-serve` | Serve the REST API, or migrate a self-hosted database. |
| `economy-otel` | Ingest OTLP/HTTP metrics or simplified cost events into local SQLite. |

Use `<binary> --help` and `economy <command> --help` for the exact help emitted by the installed version.

## Core commands

The supported coding-agent values are `claude`, `takumi`, `codex`, `gemini`, `opencode`, `cursor`, `pi`, and `hermes`.

| Command | Current behavior and principal options |
| --- | --- |
| `economy sync` | Ingest every local source, or select sources with `--claude`, `--takumi`, `--codex`, `--gemini`, `--opencode`, `--cursor`, `--pi`, `--hermes`, or `--loops`. Maintenance flags are `--force`, `--backfill-machine`, and `--recalculate`; `--verbose` prints source details. In cloud-client mode the on-box provider files are read on this machine and pushed to the shared API. |
| `economy today`, `week`, `month` | Auto-sync (local SQLite, or cloud-client push of this machine's on-box provider files) and print the corresponding summary. |
| `economy sessions` | List sessions. Filters: `--agent`, `--project`, `--account`, `--machine`, `--since`, and `--search`; `--limit` defaults to 20; `--format` is `table`, `compact`, `csv`, or `json`. |
| `economy session <id>` | Show one session and its requests. IDs may be prefixes. `--limit` defaults to 20 and `--verbose` shows up to 50 requests. |
| `economy top` | Rank expensive sessions with `-n`, `--agent`, and `--since`. |
| `economy breakdown` | Group by `model`, `agent`, `project`, `account`, `cost-center`, `loop`, `app`, or `repo`; accepts `--since`, `--limit`, `--verbose`, and `--json`. |
| `economy accounts [period]` | Account/profile totals for `today`, `week`, `month`, `year`, or `all`; accepts `--limit`, `--verbose`, and `--json`. |
| `economy machines` | Machines represented in stored data; accepts `--limit` and `--verbose`. |
| `economy fleet` | Shared summary plus per-machine rows; accepts `--period`, `--limit`, `--verbose`, and `--json`. |
| `economy brief` | Fleet brief with `--since <24h|7d|ISO-date>`, `--machine <id|all>`, or `--json`. |
| `economy usage [period]` | Quota/usage snapshots with `--agent`, `--limit`, `--verbose`, or `--json`. |
| `economy savings [period]` | Subscription-versus-API-equivalent savings with `--agent` or `--json`. |
| `economy watch` | Poll recent costs, or use `--daemon` to sync watched local paths. Also accepts `--interval`, `--agent`, and macOS `--notify`. In cloud mode it streams the API and does not ingest local files. |
| `economy status` | Print one-line spend, fleet, storage, top-agent, and available quota status. |
| `economy doctor` | Check source paths/token availability, storage mode, pricing gaps, deduplication, and billing drift. |
| `economy transport` | Report the resolved client transport and credential SOURCE (never the key): the `/v1` authority, the URL/key source names, and the credential tier from the `@hasna/contracts` chain; `--json` for the full report. Exits 0 even when unconfigured — the refusal is the report. |
| `economy init` | Print first-run local and cloud-client setup hints. |

Human output for high-cardinality commands is intentionally capped. Use the command's `--json`, `--verbose`, or `--limit` option when available. JSON output is complete; `--verbose` has command-specific semantics, so consult `--help`.

## Analysis and export

| Command | Behavior |
| --- | --- |
| `economy export` | Export `sessions` or `requests` as CSV. `--period` accepts `today`, `week`, `month`, or `all`; `--output` writes a file instead of stdout. |
| `economy compare <period1> <period2>` | Compare `today`, `yesterday`, `week`, `lastweek`, `month`, or `lastmonth`. |
| `economy forecast` | Project the current month's total from the observed burn rate. |
| `economy efficiency` | Show output/input ratio, cache-hit percentage, and cost per 1,000 output tokens by model. |
| `economy estimate --model <id>` | Estimate cost from `--input` and `--output` token counts using the active pricing table. |
| `economy tui` | Terminal dashboard; `--watch` refreshes at `--interval` seconds. |
| `economy waybar` | Emit a Waybar-compatible JSON status object. |
| `economy bar tui`, `bar waybar` | Aliases for the TUI and Waybar commands. |

## Data management

| Command group | Subcommands |
| --- | --- |
| `economy budget` | `set` (`--limit` required; optional `--project`, `--agent`, `--cost-center`, `--period`, `--alert`), `list` (`--limit`, `--verbose`), `remove <id>`. |
| `economy goal` | `set` (`--limit` required; optional `--period`, `--project`, `--agent`), `list`, `status`, `remove <id>`. List/status accept `--limit` and `--verbose`. |
| `economy project` | `add <path> [--name]`, `list`, `show <nameOrPath>`, `rename <path> <name>`, `remove <path>`. |
| `economy pricing` | `list`, `set <model>`, `remove <model>`. Set accepts `--input`, `--output`, `--cache-read`, `--cache-write`, `--cache-write-1h`, and `--cache-storage`. |
| `economy subscriptions` | `set` (requires `--provider` and `--plan`; optional `--agent`, `--fee`, `--included`), `list`, `remove <id>`. |
| `economy billing` | `sync` (`--days`, provider selectors), `show --period`, and `diff --period`. Provider billing is fetched from the provider APIs on this machine; in cloud-client mode the rows are pushed to the shared API. |
| `economy config` | Show config, `get <key>`, `set <key> <value>`, or `webhook-test`. See [configuration](configuration.md). |
| `economy remove <type> <id>` | Top-level alias for removing a `budget`, `project`, `goal`, or `pricing` row. Alias: `rm`. |

## Integrations and utilities

| Command | Behavior |
| --- | --- |
| `economy serve --port <port>` | Start the REST API in-process. Equivalent server controls are documented under [`economy-serve`](configuration.md#rest-server). |
| `economy mcp` | Print Claude Code, Codex, and Gemini MCP configuration; select one or use `--all`. |
| `economy completion <shell>` | Print completion for `bash`, `zsh`, or `fish`. |
| `economy menubar` | `install [--force]`, `start`, `stop`, or `uninstall` the macOS Economy Bar app. |
| `economy events`, `economy webhooks` | Event emit/list/replay and event-subscription commands supplied by `@hasna/events`; use the nested `--help` for options. |
| `economy todos` | Display the bundled Economy roadmap, filter tasks, or show a task ID. This is project planning data, not live service status. |

## Other binary help

```text
economy-mcp [--http] [--port <port>]
economy-serve [--port <port>]
economy-serve migrate
economy-serve version
economy-otel [--port <port>]
```

`economy-mcp` and `economy-serve` support `--version`. See [MCP](mcp.md), [configuration](configuration.md), and [OTLP](otel.md) for environment controls and endpoints.
