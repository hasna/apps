---
"@hasna/todos": patch
---

Count a PostgreSQL tombstone as applied only when the database returns its row. Stale writes rejected at submillisecond precision now report skipped instead of falsely reporting a deletion.
