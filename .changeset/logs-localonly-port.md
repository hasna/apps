---
"@hasna/logs": patch
---

Port the local-only store operations to the hosted /v1 backend (localonly-logs): `logs scan` and `logs watch --events` (plus the MCP `event_watch` tool) now work in api mode through the mode-resolved Store — the headless scan executes client-side with every result (logs, perf snapshot, scan-run record, page/job bookkeeping) delivered through the hosted data plane, and the event-catalog live-tail walks (event_time, event_id) cursors via the new `after_time`/`after_id`/`order` query on GET /v1/events. New /v1 maintenance routes: GET/PUT /jobs/:id, POST /jobs/:id/runs, PATCH /jobs/:id/runs/:runId, GET/PATCH /pages/:id, POST /perf/snapshot. The `db doctor` raw-segment family (segments/rebuild-index/repair-segments) stays local-only with the strong reason recorded in src/store/index.ts: the hosted tier deliberately persists no raw JSONL segments (redacted records, raw: null), so those operations have no hosted subject; the reviewer rules on that record.
