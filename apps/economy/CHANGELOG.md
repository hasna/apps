# Changelog

All notable changes to this repository are tracked here. This project follows semantic versioning for published npm packages when practical.

## @hasna/economy Unreleased

Two PRs merged after `0.3.9`; neither is published yet.

- **#32** `fix(economy)` — `breakdown --since` now actually filters the billing
  window it reports, and `doctor` stops certifying drift between two zeroes: when
  no provider billing was imported, or the imported total is zero, drift is
  reported as UNKNOWN instead of a false `0.0%` green tick.
- **#33** `feat(contracts)` — satisfy the contracts `published_artifact_gate`:
  `prepack` builds into `dist` and runs `contracts artifact-scan dist`, so a
  packed tarball is scanned before it reaches the registry.

## @hasna/economy 0.3.9 - 2026-08-04

Release-only bump. Four PRs merged after `0.3.8` and were never published, because
this repo has no workflow that runs `npm publish` — the registry sat at `0.3.8`
while `main` accumulated a contracts migration, a data-correctness fix and a
metadata correction.

**Breaking for server operators.** `HASNA_ECONOMY_STORAGE_MODE` (and the
`ECONOMY_STORAGE_MODE` alias) are retired for server backend selection. They are
now *rejected at startup with a migration hint* rather than normalized, so a
half-migrated deployment fails loudly instead of quietly serving the wrong store.
The server data backend is `sqlite | postgresql`, selected by the presence of
`HASNA_ECONOMY_DATABASE_URL` alone. If you set `HASNA_ECONOMY_STORAGE_MODE=cloud`
to reach Postgres, unset it and rely on the database URL.

- **#27** `fix(client)` — hard-fail a half-applied cloud flip instead of silently
  serving local data. An `API_URL` set *without* an `API_KEY` previously resolved
  to `local` with no warning, byte-identical to an unconfigured host: the CLI
  served the local SQLite store while the operator had pointed it at the cloud
  API — a different dataset rendered as plausible spend numbers. It now reports
  `misconfigured` and refuses. An unconfigured machine (neither variable set)
  stays silently local; that negative control is covered by a test.
- **#28** `fix(contracts)` — migrate `storage.mode` to `storage.backend` for
  contract kit `0.9.0`; declare `hosting` and `serviceSurfaces` in
  `hasna.contract.json`. Bumps `@hasna/contracts` `^0.4.2` -> `^0.9.0`.
- **#29** `fix(server)` — make the runtime speak the `0.9.0` backend vocabulary it
  declares; `isCloudMode()` is replaced by `resolveEconomyServerBackend()` and
  `isPostgresBackend()` (both internal — neither was ever exported from the
  package root).
- **#30** `fix(package)` — describe Gemini CLI support as legacy rather than
  active, and name the Gemini API billing ingest separately. Google retired the
  Gemini CLI on 2026-06-18.

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
