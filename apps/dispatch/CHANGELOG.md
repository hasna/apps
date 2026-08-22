# @hasna/dispatch

## 0.1.0

### Minor Changes

- Release 0.1.0: corrects the version semantics and changelog of the 0.0.27 candidate. Consumer-visible changes since 0.0.26:

  - Remove the deployment-mode concept (owner directive 2026-07-29): the client now routes on `HASNA_DISPATCH_API_URL` + `HASNA_DISPATCH_API_KEY` alone — the pair selects the hosted `/v1` authority (an incomplete pair fails closed naming the missing variable), neither set selects the on-box SQLite store, and the retired storage-mode variables (`HASNA_DISPATCH_STORAGE_MODE`/`DISPATCH_STORAGE_MODE`) now hard-error instead of selecting a backend. `DispatchApiConfigStatus` loses its `mode` and `source` fields and `hasna.contract.json` drops `deploymentModes`. Breaking: configurations still setting the deprecated variable must drop it before upgrading.
  - Adopt the fleet daemon-worker taxonomy in the SDK types: `DispatchStatus` no longer contains `delivered` (terminal states are `succeeded`, `failed`, `cancelled`, `skipped`); dispatch records rename `deliveredAt` to `succeededAt`; `ScheduleStatus` values `scheduled` -> `admitted` and `fired` -> `succeeded`; schedule fields `lastDispatchId`/`lastFiredAt` are replaced by `lastAttemptId`/`lastAttemptAt`. Breaking for consumers of the exported types.
  - Bulk dispatch now also executes on the mosaic execution slice (previously tmux-only): `DispatchClient.bulkSend` fans out through the mosaic slice with the same concurrency, jitter, per-machine limit and idle-guard semantics, with a guard when no executor is configured.
  - `hasna.contract.json` is aligned to contracts kit 0.11.1 (was 0.10.6), with the contracts CLI resolvable without shims.
  - Display name is "Hasna Dispatch" (open- prefix retired).

_Note: 0.0.27 was the originally proposed version of this release; it was never published. The version wave's draft changelog for it contained an inaccurate contracts-kit claim and is superseded by the 0.1.0 entry above._
