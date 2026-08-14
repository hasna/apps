# Shared Apps To Dedicated Loops Database Transfer

Status: source-side tooling and protected workflow source only. Do not run this
against live AWS or any live database without an approved maintenance window,
fresh recovery evidence, and the protected GitHub environment approval.

This transfer is intentionally selective. The source is the shared RDS database
`apps`; the target is the dedicated Loops database `loops`. Never snapshot
restore the shared cluster or shared database into the target.

## Fixed Command

The only production command for this lane is the no-option service command:

```bash
bun dist/serve/index.js shared-to-dedicated-transfer
```

Operators do not pass DSNs, table names, shell snippets, SQL files, or archive
paths. The command reads only these ECS task secret environment variables:

```text
HASNA_LOOPS_TRANSFER_SOURCE_DATABASE_URL
HASNA_LOOPS_TRANSFER_TARGET_DATABASE_URL
```

The source DSN must point at database `apps`. The target DSN must point at
database `loops`. The command converts both DSNs into a private `pg_service.conf`
inside a mode `0700` ephemeral directory so PostgreSQL client argv contains only
`service=openloops_transfer_source` and `service=openloops_transfer_target`.
The archive directory is removed in `finally` after success or failure.

## Sequence

1. Verify PostgreSQL 16 client binaries: `pg_dump`, `pg_restore`, and `psql`.
2. Verify source migration ledger checksums for Loops migrations
   `0001_core_runtime` through `0007_work_item_gate_deaths`.
3. Verify source quiescence: no active loop runs, workflow runs, workflow step
   runs, runner leases, or leased/running work items.
4. Initialize the dedicated target schema through migration
   `0007_work_item_gate_deaths` using the normal checksum ledger.
5. Verify the target ledger is exactly migrations `0001` through `0007` and no
   later row is present.
6. Use `pg_dump --format=custom --data-only --no-owner --no-privileges` for the
   exact Loops table allowlist:

```text
loops
workflow_specs
runner_machines
goals
loop_runs
workflow_invocations
workflow_runs
workflow_work_items
workflow_step_runs
workflow_events
goal_plan_nodes
goal_runs
runner_leases
audit_events
run_receipts
daemon_lease
```

7. Use `pg_restore --data-only --single-transaction --exit-on-error` into the
   dedicated target.
8. Apply migration `0008_tenant_prepare` on the target. This creates the
   tenant-prep tables and `api_keys` table needed for the next copy.
9. Use filtered `COPY` for only:

```sql
SELECT kid, app, agent, scopes, token_hash, issued_at, expires_at, revoked_at,
       revoked_reason, last_used_at, created_by, created_at
  FROM public.api_keys
 WHERE app = 'loops'
 ORDER BY kid;
```

10. Verify source and target row counts, canonical SHA-256 row evidence,
    target non-loop API key count, FK orphan checks, and unexpected database
    objects across schemas, tables, functions, sequences, and views.
11. Stop after producing evidence. The next approved sequence is:
    `loops-serve tenant-backfill-s3`, then
    `loops-serve migrate --enforce-tenancy`.

## Protected Workflow

`.github/workflows/shared-database-transfer.yml` is a manual protected source
surface. It accepts only a confirmation string, assumes the environment's OIDC
role, and runs one ECS Fargate task with the fixed command above. Database URLs
must come from the ECS task definition secrets, not from GitHub inputs,
repository variables, workflow logs, or operator shell overrides.

The workflow has no RDS restore or snapshot API path.
