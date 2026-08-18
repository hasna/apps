---
"@hasna/automations": patch
---

Align the daemon/queue status vocabulary to the fleet daemon/queue taxonomy (admitted/leased/terminal; lease generation, fencing token, attempt identity, terminal receipts).

- Queue-entry statuses: `queued`/`retrying` -> `admitted` (bounded retries re-admit with a distinguishable attempt number), `claimed` -> `leased`. `QueuedAction` surfaces `leasedBy`/`leasedAt`, a monotonic `leaseGeneration` (was `claim_version`), and `fencingToken` on leased entries.
- Store verbs renamed: `admitAction` (was `enqueueAction`), `leaseNextAction` (was `claimNextAction`), `readmitDeadAction`/`readmitPartialAction` (were `requeue*`), `requireQueueEntry`/`listQueueEntries` (were `requireQueuedAction`/`listQueuedActions`).
- Daemon observation surface: `automations-daemon status` reports `queueDepth`, `admitted`, `leased`, `terminal`, and `deadLetter` counts (was `queuedActions`/`deadActions`); per-entry lease health (`leasedBy`, `leaseExpiresAt`, `leaseGeneration`) is exposed on every queue listing.
- CLI: `automations queue claim` -> `automations queue lease`. Worker run receipts use `admitted` (was `enqueued`).
- Persisted schema migrated in place, no data deleted: SQLite schema 6 -> 7 renames the claim-family columns and remaps stored status values; PostgreSQL gains migration `0004_taxonomy_queue_vocabulary` (columns, status CHECK, and the partial indexes that encoded the old vocabulary). Existing migration checksums are unchanged.
