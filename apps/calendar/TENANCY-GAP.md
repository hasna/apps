# Calendar tenant boundary

The previous hosted router authenticated scopes but discarded `principal.tid`,
allowing global organization, agent, calendar, and event access. The former
exposure-characterization test has been replaced with denial assertions and real
PostgreSQL cross-tenant tests. This document describes the implemented contract;
it is not a claim that an existing deployment has been migrated or verified.

## Authority contract

- A signed Contracts API key must carry a valid `tid`. The verifier requires it;
  the router independently requires the principal's own tenant property. Request
  headers, query parameters, and JSON bodies cannot select a different tenant.
- Issuer tenant IDs follow Contracts validation and UUID canonicalization.
  `calendar_tenants.id` is an explicitly provisioned canonical issuer ID, distinct
  from Calendar's organization IDs. A tenant can own several Calendar orgs.
- A missing, unknown, or disabled tenant is denied with 403 before domain access.
  A failed registry lookup returns a sanitized 503. No tenant is auto-created.
- Each request gets an immutable tenant-scoped store. Every domain SQL read and
  final mutation binds `tenant_id`; there is no unscoped store constructor.
- `calendar:read` and `calendar:write` authorize tenant-wide reads and writes.
  Existing membership roles and calendar visibility remain domain metadata, not
  separately enforced user-level RBAC. `public` does not permit cross-tenant or
  anonymous access. Neither user-level RBAC nor cross-tenant invitations are
  claimed by this change.

## Storage contract

Migration `0003_tenant_boundary.sql` atomically adds nullable ownership columns
and a tenant registry. It never assigns existing data. New rows receive ownership
from the authenticated store, and composite foreign keys require all referenced
parents to share that tenant. Events must also match their calendar's org.
Organization slugs and agent names are unique within a tenant.

Optional-reference deletion clears only the reference column, retaining tenant
ownership. Delete guards stop old cascading foreign keys from deleting or
updating unassigned legacy children, including indirect cascades. Unassigned
rows are invisible to the API; an incomplete backfill can therefore refuse a
parent delete rather than silently modify data with unknown ownership.

## Deployment gate

Existing deployments must complete the operator procedure in `MIGRATION.md`
before activating this release. This requires an independently reviewed mapping
of existing keys and complete related row sets to issuer tenants, replacement
keys where `tid` is absent, and a read-only preflight. Never assign all data to a
first organization, a default tenant, or a caller-supplied org ID. The server role
must have SELECT only on the tenant registry; provisioning belongs to the owner
migration role. No live backfill, key issuance, or deployment is part of the
source change.

## Acceptance evidence

`src/server/tenant-boundary.pg.test.ts` uses a dedicated disposable PostgreSQL
schema, synthetic issuer keys, the real router, tenant resolver and store. It
covers every resource family, overlapping names, search/conflicts, heartbeat,
availability/memberships, concurrent requests, all parent relationships,
calendar/org disagreement, unassigned descendants, migration replay and atomic
rollback. `cloud-auth-wiring.test.ts` also proves the production verifier denies
an untenanted key before database access. The dedicated PostgreSQL CI job
requires its test database configuration and refuses a skipped suite.
