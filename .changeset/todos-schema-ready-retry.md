---
"@hasna/todos": patch
---

ensureSchema() no longer caches a rejected one-time schema sync (fixes incident 724661): the boot-time schema statements previously ran into a cached `schemaReady` promise that was never cleared on failure, so a single transient Postgres lock timeout (e.g. `canceling statement due to lock timeout`, SQLSTATE 55P03, under the `todos_app` role's 5s `lock_timeout`) was replayed on every later operation instantly — with no DB round trip — permanently bricking the store until the task was replaced. A failed sync is now cleared and retried on the next operation with fresh state. Applies to the postgres storage adapter (task write path) and the pr-groups, task-manifest, and project-registration postgres backends. Regression tests: a failed schema sync is retried on the next operation (postgres-adapter, pr-groups ledger).
