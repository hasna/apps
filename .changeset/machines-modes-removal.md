---
"@hasna/machines": patch
---

Removed the deployment-mode concept completely (owner directive 2026-07-29): deleted the dead vendored `src/cloud/mode.ts`; removed the `StorageMode` type, `getStorageMode`, `MACHINES_STORAGE_MODE_ENV`/`MACHINES_STORAGE_MODE_FALLBACK_ENV`/`STORAGE_MODE_ENV` exports and the `mode` field of `storage status` (the server backend is selected by `HASNA_MACHINES_DATABASE_URL` presence, the client by `HASNA_MACHINES_API_URL` + `HASNA_MACHINES_API_KEY`, with fail-closed rejection of legacy storage-mode variables). `machines flip --mode` now accepts exactly `api` or `local` — the retired alias words are rejected, and flip verification keys solely on `api_enabled` in the app's storage status.
