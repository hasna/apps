import { createHash } from "node:crypto";
import type { PoolQueryClient } from "../../generated/storage-kit/query.js";

const BUNDLE_SCHEMA = "open-loops.tenant-backfill/v1";
const ROLES = new Set(["admin", "operator", "member", "readonly", "service", "worker"]);
const TOKEN_KINDS = new Set(["api_key", "service", "machine"]);
const TABLES = new Set([
  "loops", "loop_runs", "daemon_lease", "workflow_specs", "workflow_runs",
  "workflow_invocations", "workflow_work_items", "workflow_step_runs", "workflow_events",
  "goals", "goal_plan_nodes", "goal_runs", "runner_machines", "runner_leases",
  "audit_events", "run_receipts",
]);

export interface TenantBackfillBundle {
  schema: typeof BUNDLE_SCHEMA;
  tenants: Array<{ id: string; slug: string; name: string; status: "active" | "suspended" }>;
  principals: Array<{ id: string; kind: "human" | "service" | "machine"; displayName: string; status: "active" | "suspended" }>;
  memberships: Array<{ tenantId: string; principalId: string; status: "active" | "suspended"; roles: string[] }>;
  keyBindings: Array<{ kid: string; tenantId: string; principalId: string; tokenKind: "api_key" | "service" | "machine" }>;
  rowAssignments: Array<{ table: string; rowId: string; tenantId: string }>;
}

function requiredText(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${path} must be a non-empty string`);
  return value.trim();
}

export function parseTenantBackfillBundle(value: unknown): TenantBackfillBundle {
  if (!value || typeof value !== "object") throw new Error("tenant backfill bundle must be an object");
  const bundle = value as Record<string, unknown>;
  if (bundle.schema !== BUNDLE_SCHEMA) throw new Error(`tenant backfill schema must be ${BUNDLE_SCHEMA}`);
  for (const field of ["tenants", "principals", "memberships", "keyBindings", "rowAssignments"]) {
    if (!Array.isArray(bundle[field])) throw new Error(`${field} must be an array`);
  }
  const parsed = bundle as unknown as TenantBackfillBundle;
  parsed.tenants.forEach((tenant, index) => {
    requiredText(tenant.id, `tenants[${index}].id`);
    requiredText(tenant.slug, `tenants[${index}].slug`);
    requiredText(tenant.name, `tenants[${index}].name`);
    if (!["active", "suspended"].includes(tenant.status)) throw new Error(`tenants[${index}].status is invalid`);
  });
  parsed.principals.forEach((principal, index) => {
    requiredText(principal.id, `principals[${index}].id`);
    requiredText(principal.displayName, `principals[${index}].displayName`);
    if (!["human", "service", "machine"].includes(principal.kind)) throw new Error(`principals[${index}].kind is invalid`);
    if (!["active", "suspended"].includes(principal.status)) throw new Error(`principals[${index}].status is invalid`);
  });
  parsed.memberships.forEach((membership, index) => {
    requiredText(membership.tenantId, `memberships[${index}].tenantId`);
    requiredText(membership.principalId, `memberships[${index}].principalId`);
    if (!["active", "suspended"].includes(membership.status)) throw new Error(`memberships[${index}].status is invalid`);
    if (!Array.isArray(membership.roles) || membership.roles.length === 0 || membership.roles.some((role) => !ROLES.has(role))) {
      throw new Error(`memberships[${index}].roles must contain normalized roles`);
    }
  });
  parsed.keyBindings.forEach((binding, index) => {
    requiredText(binding.kid, `keyBindings[${index}].kid`);
    requiredText(binding.tenantId, `keyBindings[${index}].tenantId`);
    requiredText(binding.principalId, `keyBindings[${index}].principalId`);
    if (!TOKEN_KINDS.has(binding.tokenKind)) throw new Error(`keyBindings[${index}].tokenKind is invalid`);
  });
  parsed.rowAssignments.forEach((assignment, index) => {
    if (!TABLES.has(assignment.table)) throw new Error(`rowAssignments[${index}].table is invalid`);
    requiredText(assignment.rowId, `rowAssignments[${index}].rowId`);
    requiredText(assignment.tenantId, `rowAssignments[${index}].tenantId`);
  });
  return parsed;
}

export async function loadTenantBackfillBundle(client: PoolQueryClient, bundle: TenantBackfillBundle): Promise<{ digest: string; assignments: number }> {
  const digest = createHash("sha256").update(JSON.stringify(bundle)).digest("hex");
  await client.transaction(async (tx) => {
    const migration = await tx.get<{ id: string }>(
      "SELECT id FROM open_loops_schema_migrations WHERE id = '0008_tenant_prepare'",
    );
    if (!migration) throw new Error("apply migration 0008_tenant_prepare before loading a tenant bundle");
    const enforced = await tx.get<{ id: string }>(
      "SELECT id FROM open_loops_schema_migrations WHERE id = '0010_tenant_enforce'",
    );
    if (enforced) throw new Error("tenant enforcement is already complete");

    for (const tenant of bundle.tenants) {
      await tx.execute(
        `INSERT INTO tenants(id, slug, name, status) VALUES ($1,$2,$3,$4)
         ON CONFLICT (id) DO UPDATE SET slug=EXCLUDED.slug, name=EXCLUDED.name, status=EXCLUDED.status, updated_at=now()`,
        [tenant.id, tenant.slug, tenant.name, tenant.status],
      );
    }
    for (const principal of bundle.principals) {
      await tx.execute(
        `INSERT INTO principals(id, kind, display_name, status) VALUES ($1,$2,$3,$4)
         ON CONFLICT (id) DO UPDATE SET kind=EXCLUDED.kind, display_name=EXCLUDED.display_name, status=EXCLUDED.status, updated_at=now()`,
        [principal.id, principal.kind, principal.displayName, principal.status],
      );
    }
    for (const membership of bundle.memberships) {
      await tx.execute(
        `INSERT INTO tenant_memberships(tenant_id, principal_id, status) VALUES ($1,$2,$3)
         ON CONFLICT (tenant_id, principal_id) DO UPDATE SET status=EXCLUDED.status, updated_at=now()`,
        [membership.tenantId, membership.principalId, membership.status],
      );
      await tx.execute("DELETE FROM tenant_membership_roles WHERE tenant_id=$1 AND principal_id=$2", [
        membership.tenantId,
        membership.principalId,
      ]);
      for (const role of [...new Set(membership.roles)]) {
        await tx.execute(
          "INSERT INTO tenant_membership_roles(tenant_id, principal_id, role) VALUES ($1,$2,$3)",
          [membership.tenantId, membership.principalId, role],
        );
      }
    }
    await tx.execute("DELETE FROM api_key_tenant_bindings");
    for (const binding of bundle.keyBindings) {
      await tx.execute(
        "INSERT INTO api_key_tenant_bindings(kid, tenant_id, principal_id, token_kind) VALUES ($1,$2,$3,$4)",
        [binding.kid, binding.tenantId, binding.principalId, binding.tokenKind],
      );
    }
    await tx.execute("DELETE FROM tenant_row_assignments");
    for (const assignment of bundle.rowAssignments) {
      await tx.execute(
        "INSERT INTO tenant_row_assignments(table_name, row_id, tenant_id) VALUES ($1,$2,$3)",
        [assignment.table, assignment.rowId, assignment.tenantId],
      );
    }
  });
  return { digest: `sha256:${digest}`, assignments: bundle.rowAssignments.length };
}
