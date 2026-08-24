---
"@hasna/conversations": patch
---

Fix hosted message/task sends failing with `invalid input syntax for type timestamp with time zone` (todos 445de05e). The server bound `String(created_at)` — where `pg` returns a real JS `Date` — into the Conversations→Events outbox `created_at` TIMESTAMPTZ column, and `String(date)` produced `Date.toString()` format (`"Mon Aug 24 2026 ... GMT+0000"`) instead of ISO 8601. Every `conversations send` to the hosted API returned HTTP 400.

- Server: new `isoDbTimestamp()` coerces a `Date` to `.toISOString()` (strings pass through); used for the message-create and task-create outbox envelope `time` values that are bound to the timestamp column.
- Server: the read-path preview serializer `boundedSafeString()` is now Date-aware, so cloud message reads emit ISO `created_at`/`edited_at`/`pinned_at` instead of `Date.toString()`.
- Test: regression test mimics `pg` by returning a `Date` from the fake messages INSERT and asserts the outbox `created_at` param is ISO 8601.

Deployment note: the hosted server must be redeployed with the new `api.ts` for the fleet to see the fix.
