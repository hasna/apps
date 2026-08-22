---
"@hasna/todos": patch
---

task-subtree-transfer postgres backend: `ensureSchema()` no longer caches a rejected one-time schema sync. The `schemaReady ??=` memo (apps/todos/src/task-subtree-transfer/postgres.ts) previously kept the rejected promise forever, so a single transient Postgres lock timeout (SQLSTATE 55P03) during the boot-time schema statements was replayed on every later transfer operation instantly — with no DB round trip — permanently bricking the subtree-transfer authority (wired into the same process as the storage adapter via the cached singleton in server/cloud.ts). A failed sync is now cleared and retried on the next operation with fresh state, matching the pattern landed for the storage adapter (PR #931) and pr-groups / project-registration (PR #933). Regression test: a failed schema sync is retried on the next operation instead of being cached forever (task-subtree-transfer-schema-retry.test.ts).
