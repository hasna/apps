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

## Source-contract reinspection (2026-09-02)

Rechecked against PR #1489 head `fbb860631e0e94173103e5a664a07e06013ee2ee`:

- `apps/contracts/docs/AUTH_RBAC_VERIFIER_CONTRACT.md`, "Tenant Identifier",
  requires an organization-scoped service to reject keys without `tid` (403).
  Its "Boundary Rules" require predicates before every query/mutation and
  overlapping-identifier multi-tenant negative fixtures. Calendar does neither.
- The same contract's "tid -> org" section and
  `apps/contracts/src/auth/identity.ts:TenantOrgResolver` explicitly distinguish
  issuer tenant IDs from the service's organization IDs. Unknown mappings must
  deny; they must not auto-provision an organization. The generic resolver is
  not a Calendar provisioning rule or evidence that `tid === org.id`.
- Calendar's only domain migration contains no issuer-tenant mapping. Its
  OpenAPI has organization CRUD, globally named agents, memberships in multiple
  organizations, and public/org/private calendars, but no bootstrap or
  tenant-admin authorization contract. The verified authentication claim alone
  therefore cannot determine authorized rows for all existing operations.
- PR #459 overlaps manifest/artifact lifecycle only. It does not supply the
  missing tenancy contract. No live deployment or private database state was
  consulted to invent one.

### Minimal contract choices for owner review — not implemented defaults

1. **Shared multi-tenant service:** explicitly provision issuer-tenant-to-local-org
   mappings, rejecting missing/unknown tenants before domain access. The contract
   must specify who provisions/rebinds them and how existing organizations and
   keys migrate, without assuming equivalent IDs or modifying existing data.
2. **Explicit single-tenant service boundary:** pin one authenticated issuer
   tenant to one explicitly selected existing organization. This still requires
   a decision for organization creation/list/delete and global agent operations;
   it is not a silent downgrade of the current multi-organization capabilities.

Either choice needs the same bounded policy matrix: global versus tenant-owned
agents; membership role grants and cross-org membership visibility; calendar
visibility/ownership; event/calendar organization consistency; attendees and
availability through their parent resources; and administrative/bootstrap
permissions. Define those decisions before implementation, then cover read,
create, update, delete, search/conflicts, heartbeat and relationship edges with
two-tenant allow/deny tests, including overlapping identifiers and an unknown or
absent tenant. Current exposure-characterization tests are not acceptance tests.

The response-envelope repair does not change authentication, queries, schemas,
roles, provisioning, or legacy keys. Tenant isolation remains **NO_GO**.
