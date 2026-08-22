[REVIEW] NO_GO — @hasna/todos@0.15.44 @ f780567980d7cdba7eb79356c2f7b735de8adbab — registry npmjs

- P1 — `apps/todos/src/storage/postgres-adapter.ts:2847`: the Postgres sync adapter still compares `updated_at` as raw text. A newer space-form timestamp such as `2026-08-20 23:00:00` is lexically less than ISO cursor `2026-08-20T21:00:00Z`, so changed tasks are silently omitted; unparseable timestamps are also dropped.

- P1 — `apps/todos/src/cli/cloud-router.ts:3410`: the cloud changed-since/report path has the same raw lexical comparison. Cloud tasks with space-form timestamps newer than an ISO cursor are silently excluded from CLI summaries and activity reports.

- P1 — `apps/todos/src/task-subtree-transfer/postgres.ts:90-94`: `schemaReady` caches a rejected schema-sync promise without clearing it. A transient Postgres DDL/lock-timeout during `inspect`, `apply`, `readExact`, or `rollback` poisons that backend, causing every later operation to fail immediately until process restart.