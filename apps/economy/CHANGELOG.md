# Changelog

All notable changes to this repository are tracked here. This project follows semantic versioning for published npm packages when practical.

## @hasna/economy 0.3.7 - 2026-07-24

- Reconciled `main` with the published npm line: the deployed `0.3.x` code (`0.3.0`–`0.3.6`, including the unified `Store` refactor and the cloud/self_hosted service surfaces) had shipped to npm but was never merged back to `main`, which still sat at `0.2.45`. The published `v0.3.6` tag (commit `4f76834d`) is a strict descendant of `main` (18 ahead / 0 behind), so this was a clean fast-forward with no main-only commits at risk.
- Fixed a version anomaly: the published `v0.3.6` tag commit carried `package.json` version `0.3.5` (the `0.3.6` publish bumped the registry without a follow-up commit). This release bumps strictly above the published `0.3.6` latest to `0.3.7` so the git tree and npm line are consistent again.

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
