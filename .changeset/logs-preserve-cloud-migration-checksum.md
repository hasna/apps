---
"@hasna/logs": patch
---

Restore the immutable checksum of the already-applied PostgreSQL base migration while retaining the artifact `object_key` column in its additive migration. This lets the sanctioned migrate-before-deploy gate verify existing Logs databases instead of refusing current server releases as historical SQL drift.
