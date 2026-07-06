# Changelog

All notable changes to `@hasna/machines` are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.64] - 2026-07-06

### Added

- Added `machines reconcile`: desired-state package reconcile for
  machines-agent. Plans and executes `bun install -g pkg@version` against the
  manifest, verifies CLI `--version` (and declared `hasna-*-mcp` health
  endpoints), rolls back to the prior version on verification failure, and
  emits `hasna.rollout_record.v1` events (`release.rollout.started/completed/
  failed`, `app.installed`) through the `@hasna/events` envelope. Dry-run by
  default; `--apply` requires scoped mutation approval. Triggerable from a
  `release.published` event via `--event-json` or `reconcileFromReleaseEvent`.
- Added `machines freeze add|remove|list|check`: supply-chain freeze gate that
  blocks reconcile installs/updates of frozen packages (ported from the
  skill-package-update incident-freeze rule), with optional `--until` expiry
  and manifest-declared fleet-wide freeze entries.
- Extended the `machines.json` schema (backward compatible): fleet-wide
  `packages` desired-state list, `freeze` list, and per-package `appId`,
  `bin`, and `mcpHealthUrl` fields aligned with the distribution contracts.

### Fixed

- Made the consumer conformance fixture hermetic: "SDK absent" cases now
  install an always-failing tombstone package so ambient `node_modules`
  directories above the temp app (for example `/tmp/node_modules`) cannot leak
  a real `@hasna/machines` into resolution.

## [0.0.63] - 2026-07-04

### Added

- Added `machines heartbeat collector-command` to emit the package-owned
  OpenLoops heartbeat collector command instead of relying on ad hoc scheduled
  shell snippets.
- Added `machines heartbeat collect --fail-on-error` so scheduled collector
  runs fail when any selected heartbeat import fails.

### Changed

- Documented that one-minute OpenLoops heartbeat collectors must use explicit
  low-latency targets and must not schedule `machines topology --all --json`,
  which only reads stale topology rows.

### Added

- Root open-source release policy files: `SECURITY.md`, `CONTRIBUTING.md`, and
  `CODE_OF_CONDUCT.md`.

### Changed

- Release verification now uses Bun package-manager commands instead of
  requiring `npm` on PATH.

## [0.0.58] - 2026-06-27

### Added

- Added loop-ready `machines ops db-integrity` and
  `machines ops state-snapshot` commands for bounded SQLite integrity checks,
  verified ops-state snapshots, private JSON evidence, and deduped todos task
  upserts.
- Added regression coverage for WAL-mode snapshot safety, sqlite3 missing
  fail-closed behavior, bounded truncation output, private report/snapshot
  permissions, retention safety, and task-upsert idempotency.

### Fixed

- Collapsed missing sqlite3 into one dependency-level task suggestion, capped
  default machine-data task creation, and fixed snapshot paths containing
  apostrophes.

## [0.0.55] - 2026-06-27

### Added

- `machines ops check` can now opt into safe deduped todos task creation with
  `--upsert-tasks --todos-project <path>` while preserving the default
  read-only diagnostics behavior.
- Added SDK exports for argv-safe Fleet Ops task upserts so deterministic loops
  can route machine/topology/tmux findings through tasks instead of tmux panes.

## Earlier Releases

Versions `0.0.1` through `0.0.54` were published before this root changelog was
introduced. Use the git history and npm registry metadata for release timing,
package provenance, and release-specific change details for those versions.
