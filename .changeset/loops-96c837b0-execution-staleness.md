---
"@hasna/loops": patch
---

A machine-pinned loop created on the hosted control plane with no `loops-runner` serving its machine stayed active and due forever with zero runs recorded and no error anywhere — the scheduler-only control plane executes only when a runner claims a loop, and no surface reported the absence (BUG 96c837b0). `loops show <id>` now computes an execution-staleness classifier (active, not archived, scheduled slot passed, zero run rows ever, past the same 10-minute overdue grace the health report already uses) and prints `UNSERVED` with the machine id and remediation hint; the same classifier is exposed as an `execution` field on `GET /v1/loops/{id}` for API consumers. The classifier only reports — it never changes who may claim what, and a loop that has ever been claimed (a run row exists) always reads `ok`. Sibling rows 94a957aa (hosted loop overdue with no run) and 67c95be4 are the same mechanism family; their resolution is tracked on the bug task.
