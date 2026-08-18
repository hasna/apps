---
"@hasna/notes": minor
---

Remove multi-machine sync machinery (single-server model): the `notes sync`/`cloud`/`billing` CLI verbs, the sync daemon and service install, the GUI SyncScheduler, sync-state handling, the machine manifest and the Machines UI surface, and the server's `/api/v1/sync` endpoint with its `sync_batches` table. The client is now a plain HTTP API client; the `personalnotes/v1` wire dialect and the server's CRUD/export endpoints are unchanged. The one-release pre-rename `PERSONALNOTES_*` env compatibility aliases are removed with it.
