# Changelog

All notable changes to this repository are tracked here. This project follows semantic versioning for published npm packages when practical.

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
