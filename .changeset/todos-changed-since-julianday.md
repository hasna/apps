---
"@hasna/todos": patch
---

getTasksChangedSince compares the since-cursor via julianday() instead of raw TEXT (fixes row 23ce88cb): stored stamps mix ISO "2026-08-05T18:54:55.814Z" with space-format "2026-06-10 11:24:47" (the DDL default datetime('now'), plus snapshot import/sync), and as text "T" sorts after " ", so the old `updated_at > ?` comparison silently excluded space-format rows that are genuinely newer than the cursor from changed-since feeds (MCP get_tasks_changed_since, sync adapter, HTTP changed-since and report routes). Mirrors the sibling updated_after predicate in task-crud.ts, including its keep-unparseable semantics: a stamp julianday() cannot parse yields NULL and the row is KEPT, because "cannot read the row's timestamp" is not "older than the cursor".
