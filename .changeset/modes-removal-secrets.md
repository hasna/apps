---
"@hasna/secrets": patch
---

Remove the deployment-mode concept (local/self-hosted/cloud) from secrets: the client selects the hosted API from `HASNA_SECRETS_API_URL` + `HASNA_SECRETS_API_KEY` (fail-closed when only one is set) else the local SQLite vault; the server selects PostgreSQL from `HASNA_SECRETS_DATABASE_URL` else SQLite. The storage-kit is regenerated (mode.ts retired; backend.ts rejects legacy `*_STORAGE_MODE` variables); `hasna.contract.json` drops the `storage.mode` block.
