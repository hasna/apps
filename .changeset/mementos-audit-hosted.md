---
"@hasna/mementos": minor
---

The immutable audit log is now readable over the hosted API: new `/v1/audit/*`
routes, and `memory_audit_trail` / `memory_audit_export` use them.

`src/db/audit.ts` read `memory_audit_log` straight out of the on-box SQLite
file and had no server route at all. On a hosted install that file holds none
of the history, so the compliance surfaces answered
`No audit entries for memory <id>` for a memory with a complete trail in the
cloud store — a confident wrong answer rather than an error.

- **New routes**: `GET /v1/memories/{id}/audit-trail` (bounded by `limit`,
  newest first), `GET /v1/audit/export` (filters `since`, `until`, `operation`,
  `agent_id`, `limit`) and `GET /v1/audit/stats`. Reads only — the table is
  append-only. It exists in both schemas already, so nothing is stubbed.
- **Clients**: the MCP tools `memory_audit_trail` and `memory_audit_export`,
  plus `getAuditStats`.
- **New `./sdk` methods**: `getMemoryAuditTrail`, `exportAuditLog`,
  `getAuditStats`, and the exported `MementosAuditEntry` type.

`GET /v1/memories/audit` is unchanged and unrelated — that is the low-trust
memory review list behind `memory_audit`, which was already hosted. A router
test pins that the new `/{id}/audit-trail` route does not shadow it.
