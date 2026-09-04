# Calendar tenant boundary: confirmed missing, NO_GO

This is a source-backed authorization finding, not an assurance report. No live
database, deployed policy, user credential or private record was inspected.
Transport hardening does not close this gap.

## Evidence

- `src/server/cloud.ts:getCloudVerifier` sets app, signing secret and key-status
  verification, but not `requireTenant` or `expectedTid`.
- `src/server/v1.ts:handleV1Request` checks `calendar:read` / `calendar:write`,
  then uses the global store. It never consumes `decision.principal.tid`.
- `@hasna/contracts/auth` provides `ApiKeyPrincipal.tid`, `requireTenant`, and
  per-call `expectedTid`. Its documented null tenant is not a wildcard.
- `src/server/pg-store.ts:listOrgs` executes `SELECT * FROM orgs ORDER BY name`;
  get/update/delete organization queries use only caller-supplied IDs/slugs.
- `migrations/0001_calendar_schema.sql` defines organizations and relationships,
  but no issuer-tenant mapping or row-level-security policy. External deployed
  database policies were not inspected and cannot be assumed to compensate.

## Adversarial reproduction (offline)

`src/server/tenant-gap.test.ts` mints a synthetic signed tenant-A key through the
real Contracts issuer and verifier, with active-key lookup mocked. The real
Calendar router and PostgreSQL store execute against a recording query fixture:

- tenant-A key receives successful list/detail responses for `org-b`;
- the same key reaches `DELETE FROM orgs WHERE id=$1` with `org-b`;
- none of the recorded queries receives `tenant-a` as a constraint;
- an otherwise valid untenanted key is accepted by the current verifier setup.

The passing tests deliberately CHARACTERIZE THE VULNERABILITY. They must not be
reported as passing tenant-isolation tests. No real rows were read or deleted.

## Decisions required before a safe tenant implementation

| Surface | Current source boundary | Missing authoritative rule |
| --- | --- | --- |
| Org list/create/delete | Global table; generic app read/write scope | Mapping of issuer `tid` to Calendar org IDs; platform-admin and bootstrap authority |
| Agents | Globally unique names; optional active org; memberships in multiple orgs | Whether agents are global or tenant-owned; cross-org visibility and updates |
| Calendars/events | Caller IDs and optional `org_id` filters | Enforce tenant on lookup/update/delete and require calendar/event org consistency |
| Attendees/availability | Event, agent and org foreign keys | Ownership through parent resources; which cross-org participants are allowed |
| Memberships | Caller-selected agent/org; list all orgs for an agent | Who may grant roles and enumerate memberships; admin versus member capabilities |
| Existing data and keys | Some keys may lack `tid`; rows lack issuer mapping | Explicit provisioning/migration and treatment of legacy untenanted identities |

Equating `tid` with an org ID, requiring it everywhere, or disabling global
operations without these rules would invent product semantics and could withdraw
existing capabilities. This scoped patch makes none of those changes. Tenant
enforcement remains a concrete release/deployment blocker requiring an approved
API/data contract, implementation, adversarial denial tests, and independent review.
