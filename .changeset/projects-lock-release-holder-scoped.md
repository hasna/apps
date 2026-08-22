---
"@hasna/projects": patch
---

Workspace-lock release is now holder-scoped by lock id (fixes 6692dc56): releaseWorkspaceLock deletes only the row whose unique id the caller acquired, so a holder whose guarded mutation outlives the 600s TTL can no longer delete a successor's live lock from a finally block. Key-only release is retained solely as the explicit admin force path (CLI unlock, MCP projects_unlock, DELETE /v1/locks/:key without lock_id).
