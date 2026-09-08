---
"@hasna/skills": patch
---

Preserve ambiguous ECS launch and stop states until the exact task is observed. Missing or partial task listings no longer permit replacement launches, and cancellation receipts require confirmed STOPPED state.

Bind every AWS ECS operation to one explicit cluster, collect bounded complete task-list pagination, and reject partial AWS responses. The optional cluster setting supports reconciliation after a client restart. Historical cancelled runs also require fresh stop proof before idempotent acceptance.
