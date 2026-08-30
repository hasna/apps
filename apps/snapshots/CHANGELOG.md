# Changelog

## 0.2.2

### Patch Changes

- e5961e9: Switch @hasna/snapshots local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/snapshots` data home (with the `HASNA_SNAPSHOTS_DIR` exact-app override layered on top of the existing `HASNA_SNAPSHOTS_DB_PATH` store override) stays the effective data home until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The default sqlite store path and the install-time provisioning of the exports/logs/plans subdirectories (postinstall.js) now resolve through the effective data home. The dependency is pinned exactly to `@hasna/paths@0.1.0` — the wave-wide pin for the hasna/apps resolver-switch lanes (XDG home migration, hotfixes plan 0f49f56a, task P3.3).
- Updated dependencies [94e6de9]
  - @hasna/paths@0.2.3

## 0.2.1

### Patch Changes

- Switch local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/snapshots` data home (with the `HASNA_SNAPSHOTS_DIR` exact-app override layered on top of the existing `HASNA_SNAPSHOTS_DB_PATH` store override) stays the effective data home until the store has been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. Install-time provisioning of the exports/logs/plans subdirectories resolves the same effective data home. Dependency pinned exactly to `@hasna/paths@0.1.0` — the wave-wide pin for the hasna/apps resolver-switch lanes (XDG home migration, hotfixes plan 0f49f56a, task P3.3).

## 0.2.0

### Minor Changes

- 225833c: Power-outage recovery verdict (2026-08-24): tmux panes now carry resume identity, opencode2 is restartable-detected, and restore has a freshness gate.

  - Capture: each tmux pane's `resume_identity` attribute resolves the newest opencode2 `session_v2` row whose `directory` matches the pane cwd (read-only, from `~/.local/share/opencode/opencode.db`) and the newest Claude Code JSONL under `~/.claude/projects/<slug>/` whose recorded `cwd` matches (content match, never the lossy slug). Configurable via `HASNA_SNAPSHOTS_OPENCODE_DB` / `HASNA_SNAPSHOTS_CLAUDE_PROJECTS_DIR`; missing sources become info diagnostics.
  - Restartable detector: `opencode2 --continue/-c/--session/-s` (OpenCode v2 resume forms) is now detected alongside the classic `--resume` agents.
  - Restore: new `--max-age <duration>` gate (env `HASNA_SNAPSHOTS_MAX_AGE`) refuses snapshots older than the configured limit with a logged, audit-trailed `restore.max-age-refused` error; the limit is recorded on the plan and re-checked at apply time.
  - Capture concurrency (station04 P1 2026-08-24): captures against one store are serialized by a short-lived SQLite lease (`capture_leases`; env `HASNA_SNAPSHOTS_CAPTURE_LEASE_TTL_MS` / `HASNA_SNAPSHOTS_CAPTURE_LEASE_WAIT_MS`), and `saveSnapshot` is idempotent — a concurrent duplicate (same-second id collision between the \*/5 cron and a manual capture) becomes a no-op instead of a `UNIQUE constraint failed: snapshot_resources` transaction failure. The store also sets `busy_timeout` before the WAL switch so concurrent store opens cannot fail with "database is locked".

### Patch Changes

- fa3a2fd: `snapshots capture` fails on macOS with "UNIQUE constraint failed: snapshot_resources.snapshot_id, snapshot_resources.resource_id" when System Events reports the same app more than once in one capture (station04 runs two Ghostty processes, so `osascript` returns `ghostty` twice and both map to the id `app:ghostty`). The osascript path of `captureMacApps` mapped every name to an id with no dedupe, so the second insert of the same (snapshot_id, resource_id) pair violated the composite primary key inside the save transaction and no snapshot was written.

  - `captureMacApps` now builds resources through a new exported `macAppResources(names, now)` helper that dedupes by resource id (a seen-set), mirroring the existing dedupe of the process-path fallback (which dedupes by app path) and the Linux `wmctrl` path (which dedupes by window class).
  - The defensive save-side dedupe (`ON CONFLICT(snapshot_id, resource_id) DO NOTHING`, landed in 0.1.6) already makes such duplicates a silent no-op; this removes the duplicate at the capture source so captures never emit them.
  - Regression tests: the station04 two-`ghostty` fixture collapses to one resource; case-variant names that slug to one id collapse; distinct apps stay distinct; a mixed duplicate list emits zero duplicate ids; an empty list emits nothing.

- 70cfd55: Capture freshness now keys off capture-RUN recency instead of newest-UNIQUE-snapshot age (todos 27f3d817). `snapshots capture` dedups identical state by design, so on a stable machine the newest unique snapshot ages past the 900s freshness threshold while the \*/5 capture cron is alive — the deployed freshness alarm was posting [INCIDENT] every 5 minutes on station02/03/04.

  - `snapshots capture` now records a capture run on EVERY attempt, including when the capture dedups (new `capture_runs` table; every attempt writes a row with `created_at`, snapshot id, duplicate-of, resource/diagnostic counts, and status).
  - New `snapshots runs` verb lists capture runs (most recent first).
  - New `snapshots freshness` verb reports `ok` based on the age of the latest capture run against the threshold (default 900s, `--threshold`), alongside the newest-snapshot ages for context. Exit code: 0 fresh, 1 stale/no-runs verdict, 2 could not determine.
  - Canonical deployed wrapper `ops/snapshots-freshness.sh` posts INCIDENT only on a genuine verdict (no runs ever, or last run stale). A "could not read the status" (exit 2) is logged and NOT posted, so a transient CLI/DB read error no longer produces a false "NO snapshots exist in the local store" INCIDENT.

## 0.1.7

### Patch Changes

- dedupe macOS app names in capture by resource id (new macAppResources helper mirrors the fallback seen-set); System Events reporting the same app twice (two Ghostty processes on station04) previously produced duplicate `app:ghostty` ids that violated the snapshot_resources composite primary key and failed every capture (PR #1109, merged fa3a2fda).

## 0.1.6

### Patch Changes

- snapshots freshness now keys off capture-RUN recency (new capture_runs run-record; `snapshots freshness` verb); the deployed wrapper posts an INCIDENT only on a genuine stale or no-runs condition (PR #1076, merged 70cfd556).

## 0.1.5

### Patch Changes

- c574f10: snapshots, snapshots-mcp and snapshots-serve answer --help and --version before any dispatch, transport connect or bind; previously `snapshots --version` printed usage JSON instead of the version, `snapshots-mcp --version` entered stdio mode and printed nothing, and `snapshots-serve --version` ignored argv and bound the HTTP port (todos row cbb7ca3d).

## 0.1.4

### Patch Changes

- 0d4f749: Add `prepack: bun run build` so `npm pack` and `npm publish` ship the built `dist` that each package's `main` points to. Previously only `prepublishOnly` built, so a clean-clone `npm pack` shipped a tarball with no code. Also add a repo-root `.editorconfig` with the member-standard style (2-space indent, LF, final newline).
- 6715109: Add hardening-roadmap validation tooling: `validate:hardening` and `validate:hardening:complete` scripts validate the hardening roadmap ledger (`ops/hardening-roadmap.json`) against its schema, `typecheck` now also checks `tsconfig.scripts.json`, and `check` runs the hardening validation before typecheck/test/build. Source-only additions (docs/ops/scripts/tests); the runtime snapshot/restore layer under `src/` is unchanged.

## 0.1.3 - 2026-07-24

PR-drain release. No runtime/behavioral changes to the snapshot/restore layer since
0.1.2; product source under `src/` is unchanged. Repository and packaging hygiene only:

- CI: add GitHub Actions workflow running typecheck + tests + build, and a `check`
  npm script (`bun run typecheck && bun test && bun run build`) (#2).
- Docs: add SDK usage examples to the README and an LOC audit report (#3).

## 0.1.2

- Add granular snapshot restore controls.

## 0.1.1

- Harden live snapshot restore on macOS.

## 0.1.0

- Initial `@hasna/snapshots` package: runtime snapshot and restore layer for Hasna
  local open-source developer environments.
