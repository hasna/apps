# CLI Reference

The package installs three binaries:

- `gateway`: configuration, routing, budget, smoke, and server commands.
- `gateway-serve`: a dedicated HTTP server entrypoint.
- `gateway-mcp`: the stdio MCP server documented in [Gateway MCP server](mcp.md).

All config-aware `gateway` commands default to `gateway.config.json`. Use `--config <path>` to select another file.

## General

| Command | Behavior |
| --- | --- |
| `gateway --help` or `gateway help` | Print command usage. `--help` after a command also prints the top-level usage. |
| `gateway --version` | Print the package version. |
| `gateway validate [--config <path>]` | Validate raw JSON config, print warnings, and exit non-zero on errors. |
| `gateway serve [--config <path>] [--host <host>] [--port <port>]` | Load config, validate runtime secrets, and start the HTTP server. CLI host and port override config. |
| `gateway smoke [--config <path>] [--model <alias>]` | Send one live chat smoke request. The model defaults to `fast`; missing credentials produce a skipped result. |
| `gateway smoke [--config <path>] --all` | Smoke-test every available provider and exit non-zero if any check fails or none pass. |

`gateway-serve` accepts `--config`, `--host`, `--port`, `--help`/`-h`, and `--version`/`-v`. Unlike `gateway serve`, invalid `--port` text is passed to `Bun.serve` as `NaN` rather than falling back to the configured port.

## Routing

| Command | Options and output |
| --- | --- |
| `gateway route --model <alias>` | Dry-run chat route selection without provider traffic. Add `--stream` to require streaming capability, `--json` for the raw decision, or `--json --contract` for `hasna.decision_envelope.v1`. |
| `gateway routes` | List configured route ids. Add `--json` for route summaries or `--json --contract` for `hasna.capability_card.v1` records. |

Route failures exit non-zero. JSON modes include the rejected route decision when one is available.

## Budgets

| Command | Options and output |
| --- | --- |
| `gateway budget-add --id <id>` | Add or replace a config budget. `--window` defaults to `lifetime`; `--mode` defaults to `hard`. Scope with `--gateway-key`, `--tenant`, and `--model`. Limits are `--max-usd`, `--max-input-tokens`, `--max-output-tokens`, `--max-total-tokens`, and `--warning-threshold`. Add `--json` for structured output. |
| `gateway budget-list` | List budget ids, or full normalized definitions with `--json`. |
| `gateway budget-remaining` | Calculate matching statuses. Filter with `--id`, `--tenant`, and `--model`; add `--json`, or `--json --contract` for `hasna.cost_estimate.v1`. |
| `gateway budget-reset --id <id>` | Set the budget's `resetAt` to the current time. Add `--json` for structured output. |

Numeric budget flags must be non-negative. `budget-add` validates the complete config before writing it.

## Local Removal

`gateway uninstall --yes` removes the selected config file and its configured local JSONL usage ledger. `gateway remove --all --yes` is an alias with an additional explicit `--all` safeguard. Both refuse to continue without a bare `--yes`, refuse to remove directories, tolerate an already-absent ledger, and support `--json` output. The selected config must exist so the command can discover the ledger path.

These commands do not remove the npm package, environment variables, SQLite/Postgres data, or any other file referenced by the config.
