---
"@hasna/dispatch": patch
---

Remove the deployment-mode concept (owner directive 2026-07-29). The client now routes on `HASNA_DISPATCH_API_URL` + `HASNA_DISPATCH_API_KEY` alone: the pair selects the hosted `/v1` authority (an incomplete pair fails closed naming the missing variable), neither set selects the on-box SQLite store, and any retired storage-mode variable (`HASNA_DISPATCH_STORAGE_MODE`/`DISPATCH_STORAGE_MODE`) now hard-errors instead of selecting a backend. `DispatchApiConfigStatus` loses its `mode` and `source` fields; the contract kit moves to 0.10.6 and hasna.contract.json drops `deploymentModes`. Breaking/behavioral change: configurations still setting the deprecated variable must drop it before upgrading.
