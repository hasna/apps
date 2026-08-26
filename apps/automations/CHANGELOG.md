# Changelog

## 0.3.2

### Patch Changes

- 8bd09f3: Switch @hasna/automations local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/automations` default (with the `HASNA_AUTOMATIONS_DIR` / `AUTOMATIONS_DATA_DIR` exact-app overrides) stays the effective data home until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The dependency is pinned exactly to `@hasna/paths@0.1.0` (XDG home migration, hotfixes plan 0f49f56a, task P3.3).
- Updated dependencies [984b147]
  - @hasna/actions@0.2.4

## 0.3.1

### Patch Changes

- Switch @hasna/automations local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/automations` default (with the `HASNA_AUTOMATIONS_DIR` / `AUTOMATIONS_DATA_DIR` exact-app overrides) stays the effective data home until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The dependency is pinned exactly to `@hasna/paths@0.1.0` (XDG home migration, hotfixes plan 0f49f56a, task P3.3).

## 0.3.0

### Minor Changes

- The `hasna-automations` bin alias is removed from the published package; use
  `automations` instead. `@hasna/contracts` repo-conformance (`bins_allowlisted`)
  only permits `automations` and `automations-daemon`. Anything resolving
  `^0.2.0` that invokes `hasna-automations` will fail with
  `command not found` after upgrading; this is released as a minor bump (0.3.0),
  not a patch (#10). `automations` and `automations-daemon` are unchanged.

### Patch Changes

- cef7421: Align the daemon/queue status vocabulary to the fleet daemon/queue taxonomy (admitted/leased/terminal; lease generation, fencing token, attempt identity, terminal receipts).

  - Queue-entry statuses: `queued`/`retrying` -> `admitted` (bounded retries re-admit with a distinguishable attempt number), `claimed` -> `leased`. `QueuedAction` surfaces `leasedBy`/`leasedAt`, a monotonic `leaseGeneration` (was `claim_version`), and `fencingToken` on leased entries.
  - Store verbs renamed: `admitAction` (was `enqueueAction`), `leaseNextAction` (was `claimNextAction`), `readmitDeadAction`/`readmitPartialAction` (were `requeue*`), `requireQueueEntry`/`listQueueEntries` (were `requireQueuedAction`/`listQueuedActions`).
  - Daemon observation surface: `automations-daemon status` reports `queueDepth`, `admitted`, `leased`, `terminal`, and `deadLetter` counts (was `queuedActions`/`deadActions`); per-entry lease health (`leasedBy`, `leaseExpiresAt`, `leaseGeneration`) is exposed on every queue listing.
  - CLI: `automations queue claim` -> `automations queue lease`. Worker run receipts use `admitted` (was `enqueued`).
  - Persisted schema migrated in place, no data deleted: SQLite schema 6 -> 7 renames the claim-family columns and remaps stored status values; PostgreSQL gains migration `0004_taxonomy_queue_vocabulary` (columns, status CHECK, and the partial indexes that encoded the old vocabulary). Existing migration checksums are unchanged.

- Updated dependencies [ebf862c]
  - @hasna/actions@0.2.1
  - @hasna/contracts@0.12.0

All notable changes to `@hasna/automations` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-07-24

Release cutting the work merged to `main` after `0.1.3` (PR-drain).

### Added

- Launch follow-up recipe pack: T+1/3/7 engagement, Mailery enrollment, and
  uptime watch-window automations, exposed via `automations recipes list` and
  `automations recipes render launch-followup` (#1).
- Run receipts now emit `@hasna/contracts` conformant payloads; `runs list`
  and `runs show` accept a `--contract` flag (#5).
- Release webhook smoke checklist and `smoke:webhook-release` script (#7).

### Fixed

- Removed a duplicate CLI entry from the packaged bundle (#6).

### Docs

- Reconciled the automations package plan and canonical repository metadata (#2, #8).

## [0.1.3] - 2026-06-29

- Prior published baseline.
