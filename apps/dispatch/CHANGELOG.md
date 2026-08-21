# @hasna/dispatch

## 0.1.0

### Minor Changes

- Release 0.1.0: corrects the version semantics and changelog of the 0.0.27 candidate. Consumer-visible changes since 0.0.26:

  - Remove the deployment-mode concept (owner directive 2026-07-29): the client now routes on `HASNA_DISPATCH_API_URL` + `HASNA_DISPATCH_API_KEY` alone — the pair selects the hosted `/v1` authority (an incomplete pair fails closed naming the missing variable), neither set selects the on-box SQLite store, and the retired storage-mode variables (`HASNA_DISPATCH_STORAGE_MODE`/`DISPATCH_STORAGE_MODE`) now hard-error instead of selecting a backend. `DispatchApiConfigStatus` loses its `mode` and `source` fields and `hasna.contract.json` drops `deploymentModes`. Breaking: configurations still setting the deprecated variable must drop it before upgrading.
  - Adopt the fleet daemon-worker taxonomy in the SDK types: `DispatchStatus` no longer contains `delivered` (terminal states are `succeeded`, `failed`, `cancelled`, `skipped`); dispatch records rename `deliveredAt` to `succeededAt`; `ScheduleStatus` values `scheduled` -> `admitted` and `fired` -> `succeeded`; schedule fields `lastDispatchId`/`lastFiredAt` are replaced by `lastAttemptId`/`lastAttemptAt`. Breaking for consumers of the exported types.
  - Bulk dispatch now also executes on the mosaic execution slice (previously tmux-only): `DispatchClient.bulkSend` fans out through the mosaic slice with the same concurrency, jitter, per-machine limit and idle-guard semantics, with a guard when no executor is configured.
  - `hasna.contract.json` is aligned to contracts kit 0.11.1 (was 0.10.6), with the contracts CLI resolvable without shims.
  - Display name is "Hasna Dispatch" (open- prefix retired).

## 0.0.30

### Patch Changes

- Switch local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/dispatch` data dir (with the `DISPATCH_DATA_DIR` exact-app override) stays the effective data dir until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The install-time postinstall now creates the same effective data dir the runtime resolves. Dependency pinned exactly to `@hasna/paths@0.1.0` — the wave-wide pin for the hasna/apps resolver-switch lanes (XDG home migration, hotfixes plan 0f49f56a, task P3.3). (release(dispatch): version 0.1.0 — correct semver and changelog for the 0.0.27 candidate)

## 0.0.29

### Patch Changes

- e56060c: portable process-group ps probe — replace the GNU-only `--forest` flag with `ps -g` process-group selection so bun/secrets-exec-wrapped Claude Code panes are recognized on BSD/macOS hosts too (bug 5a3319ca). BSD ps rejects `--forest` ("illegal option"), the fallback `-p` showed only the wrapper row, and dispatch refused the pane ("target is not a recognized agent composer (bun)").

## 0.0.28

### Patch Changes

- 73f302a: dispatch-daemon and dispatch-mcp answer --help and --version before any bind or transport connect; previously `dispatch-daemon --version` fell through to runDaemon() and claimPid, throwing "daemon already running (pid N)" wherever a daemon was live (or starting a real daemon on a free machine), and `dispatch-mcp --version` entered MCP stdio mode, printed nothing, and exited rc=0 silently when stdin closed (todos row 8a43ca44).

_Note: 0.0.27 was the originally proposed version of this release; it was never published. The version wave's draft changelog for it contained an inaccurate contracts-kit claim and is superseded by the 0.1.0 entry above._
