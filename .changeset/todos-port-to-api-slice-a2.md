---
"@hasna/todos": minor
---

Route twelve additional MCP tools through the authoritative Todos `/v1` API.

Hosted bulk create and bulk delete now use bounded server-owned transactions. Bulk create commits every task and dependency edge together or commits nothing, including parent-guarded and plan-guarded tasks on the already-held PostgreSQL transaction client. Bulk delete snapshots authoritative child relationships, applies order-independent force semantics, requires `todos:*` for force, and returns a complete per-request receipt. Unsupported or contradictory hosted receipts fail closed without local fallback.

Archive and workload-rebalance mutation reads exhaust stable authoritative totals through bounded scalar-status pages and refuse before mutation when a selection is incomplete or exceeds 10,000 tasks. `archive_completed` uses `updated_at`, matching the established local age contract. `get_archived_tasks` now requests one server-filtered `archived_only` page, including subtasks, so a tiny archive remains readable inside a fleet-sized live corpus. Agent rosters, recent activity, task history, and dependency analytics are storage-bounded; large legacy unpaged reads fail loudly instead of materializing an unbounded dataset.

This release is server-first: deploy and prove the new bulk routes, bounded task-history response, and bounded dependency behavior before publishing a client version that depends on them.
