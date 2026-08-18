# Database Boundary Audit

This audit documents the public package database boundary for `@hasna/skills`.

## Result

The package ships the full user-hosted server: the `skills-server`, `skills-worker`,
and `skills-migrate` binaries, the implementation in `src/server/`, and the product
schema as SQL migrations in `migrations/` (one set for SQLite, one for Postgres).
The schema is the 13-table product schema below, org-scoped through the
`organizations`/`organization_members` tables and the principal-scoped store reads:

| Table | Role |
| --- | --- |
| `organizations`, `organization_members`, `users` | Org-scoped tenancy and membership |
| `api_keys` | Authenticated principals |
| `skills_registry`, `skills_bundles` | Published-skill registry with content-addressed bundles |
| `skills_runs`, `skills_run_logs`, `skills_artifacts` | Run lifecycle, logs, and artifacts |
| `skills_approvals`, `skills_audit_events` | Approval and audit trail |
| `skills_lifecycle_receipts`, `skills_credit_reservations` | Run-output governance and credit accounting |

This is a deliberate reviewed decision, not an accident: the server-in-OSS is the
intended unified surface (see `../adr/0001-open-core-boundary.md`). Searches for
hosted schema ownership must not treat skill implementation details as product
state.

Database-related files that also exist inside individual skills or examples, such
as:

- `skills/scaffold-project` templates.
- `skills/manageskill` local skill database helpers.
- `skills/managemcp` local skill database helpers.
- `skills/managehook` local skill database helpers.
- `skills/consolelog` local skill database helpers.
- `skills/database-explorer` skill runtime code.

Those are skill implementation details and must not be treated as hosted
service schema.

## Open Package State

The open package may store local user state in files:

- Project config.
- Global config.
- Pins.
- Schedules.
- Run metadata.
- Logs.
- Exports.
- Feedback.

These local files are not account state and should not become a hosted database
model.

## Hosted SaaS Wrapper State

The org-scoped user-hosted schema above is in the OSS package. What stays outside
it is the hosted SaaS layer, which, if built, owns its own schema for:

- Tenancy.
- Identity.
- API access.
- Skill registry sync.
- Pins.
- Execution.
- Async jobs.
- Approvals.
- Billing.
- Connectors.
- Audit.

A hosted SaaS wrapper should preserve tenant or organization ids, idempotency keys,
correlation ids, upstream package version, canonical skill slug, requested
skill slug, and source type such as upstream, private-hosted, uploaded, or
generated.

## Non-Goals

- Do not add hosted database requirements to the open package.
- Do not use skill-local database helper code as hosted product state.
- Do not store hosted account state in local CLI config.
- Do not let hosted workers, billing, or web routes leak into public package
  exports.
