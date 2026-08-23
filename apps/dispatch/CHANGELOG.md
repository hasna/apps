# @hasna/dispatch

## 0.0.27

### Patch Changes

- 7494238: Remove the deployment-mode concept (owner directive 2026-07-29). The client now routes on `HASNA_DISPATCH_API_URL` + `HASNA_DISPATCH_API_KEY` alone: the pair selects the hosted `/v1` authority (an incomplete pair fails closed naming the missing variable), neither set selects the on-box SQLite store, and any retired storage-mode variable (`HASNA_DISPATCH_STORAGE_MODE`/`DISPATCH_STORAGE_MODE`) now hard-errors instead of selecting a backend. `DispatchApiConfigStatus` loses its `mode` and `source` fields; the contract kit moves to 0.10.6 and hasna.contract.json drops `deploymentModes`. Breaking/behavioral change: configurations still setting the deprecated variable must drop it before upgrading.
- 7872575: Align the dispatch vocabulary to the fleet daemon-worker taxonomy (breaking change, release-review P1 remediation). `DispatchStatus` values `pending`/`sending`/`delivered`/`scheduled` become `admitted`/`running`/`succeeded`; `BulkDispatchResult.delivered` becomes `succeeded`; `DispatchRecord.deliveredAt` becomes `succeededAt`; `ScheduledDispatch.lastDispatchId`/`lastFiredAt` become `lastAttemptId`/`lastAttemptAt`. Hosted `/v1` responses validate only the new values and field names, so a consumer against an older 0.0.26-compatible authority fails closed with `DispatchApiMalformedResponseError`. Breaking for consumers of the old names: upgrade the client and the authority together.
