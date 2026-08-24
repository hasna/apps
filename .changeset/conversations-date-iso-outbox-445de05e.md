---
"@hasna/conversations": patch
---

Conversations→Events outbox and timestamp correctness fixes:

- **Hosted create path binds ISO-8601 outbox timestamps** (message-create and task-create): `pg` returns `timestamptz` as a JS `Date`, and `String(date)` produced the JS `toString` format that Postgres refuses to parse (`invalid input syntax for type timestamp with time zone`) — every `conversations send` to the hosted API returned HTTP 400 (todos 445de05e, 041b4e3a).
- **Read-path preview serializer is Date-aware**: `boundedSafeString` now coerces a `Date` to `.toISOString()`, so cloud message reads emit ISO `created_at`/`edited_at`/`pinned_at` instead of `Date.toString()`.
- **Pending-outbox reads break same-ms `created_at` ties on insertion rowid** instead of the random uuid id, making blocked/unblocked (and any same-ms pair) delivery order deterministic (todos 156a9d7c).
- Regression tests: in-memory hosted message-create asserts the outbox `created_at` param is ISO; a hosted-PostgreSQL verifier exercises the real `/v1/messages` create path; an outbox-order test covers same-ms ties.

Deployment note: the hosted server must be redeployed with the new `api.ts` for the fleet to see the fix.
