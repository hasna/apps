# @hasna/dispatch

## 0.0.30

### Patch Changes

- Switch local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/dispatch` data dir (with the `DISPATCH_DATA_DIR` exact-app override) stays the effective data dir until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The install-time postinstall now creates the same effective data dir the runtime resolves. Dependency pinned exactly to `@hasna/paths@0.1.0` — the wave-wide pin for the hasna/apps resolver-switch lanes (XDG home migration, hotfixes plan 0f49f56a, task P3.3).

## 0.0.29

### Patch Changes

- e56060c: portable process-group ps probe — replace the GNU-only `--forest` flag with `ps -g` process-group selection so bun/secrets-exec-wrapped Claude Code panes are recognized on BSD/macOS hosts too (bug 5a3319ca). BSD ps rejects `--forest` ("illegal option"), the fallback `-p` showed only the wrapper row, and dispatch refused the pane ("target is not a recognized agent composer (bun)").

## 0.0.28

### Patch Changes

- 73f302a: dispatch-daemon and dispatch-mcp answer --help and --version before any bind or transport connect; previously `dispatch-daemon --version` fell through to runDaemon() and claimPid, throwing "daemon already running (pid N)" wherever a daemon was live (or starting a real daemon on a free machine), and `dispatch-mcp --version` entered MCP stdio mode, printed nothing, and exited rc=0 silently when stdin closed (todos row 8a43ca44).

## 0.0.27

### Patch Changes

- 7494238: Remove the deployment-mode concept (owner directive 2026-07-29). The client now routes on `HASNA_DISPATCH_API_URL` + `HASNA_DISPATCH_API_KEY` alone: the pair selects the hosted `/v1` authority (an incomplete pair fails closed naming the missing variable), neither set selects the on-box SQLite store, and any retired storage-mode variable (`HASNA_DISPATCH_STORAGE_MODE`/`DISPATCH_STORAGE_MODE`) now hard-errors instead of selecting a backend. `DispatchApiConfigStatus` loses its `mode` and `source` fields; the contract kit moves to 0.10.6 and hasna.contract.json drops `deploymentModes`. Breaking/behavioral change: configurations still setting the deprecated variable must drop it before upgrading.
- 7872575: Align the dispatch vocabulary to the fleet daemon-worker taxonomy (breaking change, release-review P1 remediation). `DispatchStatus` values `pending`/`sending`/`delivered`/`scheduled` become `admitted`/`running`/`succeeded`; `BulkDispatchResult.delivered` becomes `succeeded`; `DispatchRecord.deliveredAt` becomes `succeededAt`; `ScheduledDispatch.lastDispatchId`/`lastFiredAt` become `lastAttemptId`/`lastAttemptAt`. Hosted `/v1` responses validate only the new values and field names, so a consumer against an older 0.0.26-compatible authority fails closed with `DispatchApiMalformedResponseError`. Breaking for consumers of the old names: upgrade the client and the authority together.
