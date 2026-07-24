# Changelog

All notable changes to this repository are tracked here. This project follows semantic versioning for published npm packages when practical.

## @hasna/economy 0.3.7 - 2026-07-24

Reconciliation release: `main` had diverged from the published npm line. The `0.3.x`
code (`0.3.0`-`0.3.6`, the unified `Store` refactor plus the cloud/self_hosted service
surfaces) shipped to npm from `feature`-line commits and was never merged back, while
`main` (`0.2.52`) carried two merged-but-unpublished features. This release is a real
three-way merge that keeps **both** histories.

- Merged the published `v0.3.6` tag (`4f76834`) into `main`, preserving both parents.
- Forward-ported **compact CLI/MCP output defaults** (#4) onto the `Store` surfaces:
  `--limit`/`--verbose`/`--json` on `breakdown`, `budget list`, `project list`,
  `pricing list`, `goal list`, `goal status`, `usage`, `subscriptions list`, `fleet`;
  `limit`/`verbose`/`json` params on the `get_model_breakdown`, `get_project_breakdown`,
  `get_account_breakdown`, `get_budget_status`, `get_pricing`, `get_goals`,
  `list_machines`, `get_session_detail`, `get_usage`, `get_savings`, `sync` and
  `set_subscription` MCP tools.
- Forward-ported **token cost centers** (#5) onto the `Store` architecture: added
  `EconomyStore.costCenterBreakdown()` (local SQLite + cloud `/v1` transports),
  `cost_center_id` on `BudgetInput`, and the `breakdown --by cost-center|loop|app|repo`
  CLI dimension plus the `get_cost_center_breakdown` MCP tool. The cloud transport
  drops rows the API did not attribute to a cost center, so an un-upgraded serve
  reports "no cost-center usage" instead of mislabelling model rows.
- Dropped the main-only code the `0.3.x` refactor deliberately removed as the
  forbidden DSN-on-client pattern: `src/lib/peer-sync.ts`, `src/lib/cloud-sync.ts`
  (and with it the `cloud schedule install|status|remove` commands) and
  `src/lib/fleet-sync.ts`. The MCP `sync` tool no longer reports `cloud_pushed` /
  `cloud_pulled` because `SyncAllResult` no longer carries them.
- Bumped strictly above the published `0.3.6` latest. (The `v0.3.6` tag commit itself
  carried `package.json` version `0.3.5`; the `0.3.6` publish bumped the registry
  without a follow-up commit.)

## @hasna/economy 0.2.43 - 2026-07-06

- Added the self_hosted service surface: `economy-serve` foundation probes (`GET /health`, `/ready`, `/version` -> `{ status, version, mode }`) and a versioned `/v1` API covering summaries, sessions, breakdowns, budgets, goals, pricing, subscriptions, billing, and sync.
- Added API-key authentication for the internet-facing `/v1` surface via `@hasna/contracts/auth` (stateless HMAC verify + revocation check).
- Added Amendment A1 PURE-REMOTE cloud storage: the serve reads/writes the shared RDS Postgres directly through a worker-backed synchronous PG adapter (no local cache, no sync engine in the service).
- Added a typed SDK client generated from the serve OpenAPI (`ECONOMY_API_URL` + `ECONOMY_API_KEY`).
- Added the deploy surface: ARM64/bun `Dockerfile`, `docker-compose.yml`, `hasna.contract.json`, a `migrations/` directory + runner (`economy-serve migrate`).

## @hasna/economy 0.2.41 - 2026-06-24

- Added root open-source project files for release notes, security reporting, contributing guidance, and conduct expectations.
- Added npm repository, issue tracker, and homepage metadata.
- Added package file allow-list coverage for release notes and security metadata.
- Ignored local `.takumi/` SQLite state so private local telemetry is not accidentally staged.

## @hasna/economy-sdk 0.2.1 - 2026-06-24

- Added npm repository, issue tracker, and homepage metadata.
- Added a package README and full Apache-2.0 license file to the SDK tarball.

## @hasna/economy 0.2.40 - 2026-06-24

- Added `economy brief` with text and JSON fleet summaries for tokens, cache reads/writes, cost, machine rows, agent rows, account rows, and freshness.
- Added Codewith state-store ingestion from `~/.codewith/state_5.sqlite` alongside legacy Codex ingestion, with distinct session IDs and ingest cursors.
- Added macOS machine identity fallback so apple hosts report stable machine IDs instead of generic `mac` hostnames.
- Added brief pre-read sync and SQL aggregation changes to keep the command responsive on large merged fleet databases.
- Added pricing coverage for current Claude Opus and Codewith GPT-5.5 model identifiers.
- Hardened billing, database, and Codex ingest tests used in the release verification flow.
- Published and fleet-installed `@hasna/economy@0.2.40`; the release was verified on spark01, spark02, and apple03 after correcting an apple03 Bun-global shim drift.

## @hasna/economy-sdk 0.2.0 - 2026-06-24

- Current published SDK package for the Economy REST API client.
- Release metadata now points to the public Hasna Economy repository and Apache-2.0 license.
