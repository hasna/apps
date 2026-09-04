---
"@hasna/loops": patch
---

DELETE /v1/loops/{id} no longer returns 500 `internal_error` for unknown, repeated, or malformed ids. Storage-backed not-found/conflict errors are mapped to 404 `loop_not_found` / 409 by their stable error code (previously `instanceof` matching failed across the api/storage bundle boundary and fell through to 500), malformed percent-encoded path segments return 422 `invalid_path_segment` instead of crashing the shared router, and the hosted DELETE path removes run receipts in the same transaction. `loops remove` now works on the hosted control plane (hasna/apps #1233).