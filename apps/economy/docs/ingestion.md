# Ingestion

`economy sync` imports local coding-agent usage into Economy's SQLite database. A sync with no source flag runs every source; one or more source flags limit the run. Reads such as `economy today` also auto-sync all local sources before querying.

In cloud-client mode, CLI and MCP reads/writes go directly to the shared HTTP API. Local `sync` and `billing sync` deliberately do nothing in that mode; ingest on a machine running in local mode, or use the authenticated server ingest endpoints.

## Sources

| Source | Default input | Notes and overrides |
| --- | --- | --- |
| Claude Code | `~/.claude/projects/**/*.jsonl` | Imports assistant messages with usage, including cache tiers and supported pricing modifiers. Quota uses `~/.claude/.credentials.json`, `CLAUDE_OAUTH_TOKEN`, or `ANTHROPIC_OAUTH_TOKEN`. |
| Takumi | `~/.takumi/projects/**/*.jsonl` | Uses the same JSONL ingestion format as Claude. |
| Codex | `~/.codex/state_5.sqlite`, rollout JSONL, and `~/.codex/config.toml` | Overrides: `HASNA_ECONOMY_CODEX_DB_PATH`, `HASNA_ECONOMY_CODEX_CONFIG_PATH`. Quota uses `~/.codex/auth.json` or `CODEX_OAUTH_TOKEN`; `CODEX_USAGE_URL` can override the quota URL. |
| Codewith (reported as Codex) | `~/.codewith/state_5.sqlite` and `~/.codewith/config.toml` | Overrides: `HASNA_ECONOMY_CODEWITH_DB_PATH`, `HASNA_ECONOMY_CODEWITH_CONFIG_PATH`. An explicit Codex DB path disables default Codewith discovery unless a Codewith DB path is also explicit. |
| Gemini CLI | `~/.gemini/tmp` and `~/.gemini/history` | Overrides: `HASNA_ECONOMY_GEMINI_TMP_DIR`, `HASNA_ECONOMY_GEMINI_HISTORY_DIR`. |
| OpenCode | `~/.local/share/opencode/storage/message/**/*.json` | Imports assistant-message usage and uses the recorded cost when present. |
| Cursor | Cursor `/api/usage` and `/api/usage-summary` | Requires `CURSOR_SESSION_TOKEN` (or `CURSOR_API_TOKEN`). Creates daily usage snapshots and a subscription rollup when spend is present. |
| Pi | `~/.pi/agent/sessions/**/*.json` | Override with `PI_CODING_AGENT_SESSION_DIR`. Uses recorded turn cost; a missing cost remains zero until pricing is repaired or the source records one. |
| Hermes | `~/.hermes/state.db` | Imports session-level token and cost rollups. |
| OpenLoops | `~/.hasna/loops/loops.db` | Override with `HASNA_ECONOMY_LOOPS_DB_PATH`; price with `HASNA_ECONOMY_LOOPS_MODEL` or `ECONOMY_LOOPS_MODEL`. Imports orchestration/judge `goal_runs.tokens_used` only, into `loop:*` cost centers. |

Full, unfiltered sync also attempts to import active metadata from `@hasna/projects`. Missing files, optional registries, and unavailable quota credentials are skipped; use `--verbose` to see source-level diagnostics.

## Incremental and repair behavior

File/database state is cached in the `ingest_state` table, and request IDs are upserted and deduplicated. Consequently, normal repeated syncs are incremental.

- `--force` clears the ingest-state entries for the supported sources and reprocesses them.
- `--backfill-machine` fills empty `machine_id` values with `HASNA_ECONOMY_MACHINE_ID` or the normalized hostname.
- `--recalculate` prices token-bearing requests whose `cost_usd` is zero, then rerolls affected sessions. It reports buckets still missing usable pricing.
- Budget webhooks are checked after a CLI or REST sync. Failed deliveries remain eligible for a later retry.

## Account and cost-center attribution

Economy first checks agent-specific overrides such as `ECONOMY_CODEX_ACCOUNT`, then generic `ECONOMY_ACCOUNT` overrides, then matching `@hasna/accounts` env-dir/applied/current profiles. An override may be `tool:name`, an email, or separate `*_ACCOUNT_TOOL`, `*_ACCOUNT_NAME`, and `*_ACCOUNT_EMAIL` fields. See [configuration](configuration.md#account-attribution).

Apps and services can report explicit project, repository, account, attribution-tag, and cost-center fields through [`economy-otel`](otel.md). `ECONOMY_TAG` supplies a fallback attribution tag for records written through the local database helpers.

## Provider billing

`economy billing sync --days 31` imports ground-truth daily billing locally:

- Anthropic: `HASNAXYZ_ANTHROPIC_LIVE_ADMIN_API_KEY` or `ANTHROPIC_ADMIN_API_KEY`.
- OpenAI: `HASNAXYZ_OPENAI_LIVE_ADMIN_API_KEY` or `OPENAI_ADMIN_API_KEY`.
- Gemini export: `HASNA_ECONOMY_GEMINI_BILLING_EXPORT_PATH`, `HASNAXYZ_ECONOMY_GEMINI_BILLING_EXPORT_PATH`, or `GEMINI_BILLING_EXPORT_PATH`.

Gemini imports JSON arrays, objects with a `rows` array, JSONL, or simple CSV. `economy billing show` compares totals; `economy billing diff` applies the reconciliation threshold.
