/**
 * Postgres control-plane store (the self-hosted serve path). Uses Bun's built-in
 * SQL driver (no external pg dependency). All tables live in the `sandboxes`
 * schema on the shared RDS. Every read is tenant-scoped in the WHERE clause
 * (belt); RLS (braces) is a discrete, deferred step per the execution plan and
 * is NOT enabled here (fail-closed is enforced by mandatory tenant scoping).
 */
import { SQL } from "bun";
import {
  ROOT_TENANT_ID,
  ROOT_TENANT_SLUG,
  BOOTSTRAP_PRINCIPAL_ID,
  APP_NAME,
} from "./context.js";
import { CONTROL_PLANE_DDL } from "./schema.js";
import type {
  Allocation,
  AllocationPatch,
  ApiKeyBinding,
  Checkpoint,
  ControlPlaneStore,
  Membership,
  NewAllocation,
  NewCheckpoint,
  ProviderQuota,
  StoreBackend,
  Tenant,
  User,
} from "./store.js";
import type { PrincipalType } from "./context.js";

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date(String(value)).toISOString();
}

function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return iso(value);
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map((v) => String(v));
    } catch {
      // fall through
    }
  }
  return [];
}

interface AllocationRow {
  allocation_id: string;
  tenant_id: string;
  resource_id: string | null;
  adapter_id: string;
  state: string;
  spec_sha256: string;
  spec: unknown;
  requested_by_user_id: string | null;
  state_reason: string | null;
  created_at: unknown;
  updated_at: unknown;
  expires_at: unknown;
  destroyed_at: unknown;
}

function rowToAllocation(row: AllocationRow): Allocation {
  return {
    allocation_id: row.allocation_id,
    tenant_id: row.tenant_id,
    resource_id: row.resource_id,
    adapter_id: row.adapter_id as Allocation["adapter_id"],
    state: row.state as Allocation["state"],
    spec_sha256: row.spec_sha256,
    spec: typeof row.spec === "string" ? JSON.parse(row.spec) : row.spec,
    requested_by_user_id: row.requested_by_user_id,
    state_reason: row.state_reason,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    expires_at: isoOrNull(row.expires_at),
    destroyed_at: isoOrNull(row.destroyed_at),
  };
}

export class PostgresControlPlaneStore implements ControlPlaneStore {
  readonly backend: StoreBackend = "postgres";
  private readonly sql: SQL;

  constructor(databaseUrl: string) {
    this.sql = new SQL(databaseUrl);
  }

  async migrate(): Promise<void> {
    for (const statement of CONTROL_PLANE_DDL) {
      await this.sql.unsafe(statement);
    }
    const now = new Date().toISOString();
    await this.sql`
      INSERT INTO sandboxes.tenants (tenant_id, slug, name, kind, status, created_at)
      VALUES (${ROOT_TENANT_ID}::uuid, ${ROOT_TENANT_SLUG}, ${"Hasna Root"}, ${"root"}, ${"active"}, ${now}::timestamptz)
      ON CONFLICT (tenant_id) DO NOTHING`;
    await this.sql`
      INSERT INTO sandboxes.users (user_id, user_kind, display_ref, created_at)
      VALUES (${BOOTSTRAP_PRINCIPAL_ID}::uuid, ${"agent"}, ${`${APP_NAME}:bootstrap`}, ${now}::timestamptz)
      ON CONFLICT (user_id) DO NOTHING`;
    await this.sql`
      INSERT INTO sandboxes.memberships (tenant_id, user_id, role)
      VALUES (${ROOT_TENANT_ID}::uuid, ${BOOTSTRAP_PRINCIPAL_ID}::uuid, ${"owner"})
      ON CONFLICT (tenant_id, user_id) DO NOTHING`;
  }

  async health(): Promise<{ backend: StoreBackend; ok: boolean; tenants: number; allocations: number }> {
    const rows = await this.sql`
      SELECT
        (SELECT COUNT(*)::int FROM sandboxes.tenants) AS tenants,
        (SELECT COUNT(*)::int FROM sandboxes.allocations) AS allocations`;
    const row = rows[0] as { tenants: number; allocations: number } | undefined;
    return { backend: this.backend, ok: true, tenants: row?.tenants ?? 0, allocations: row?.allocations ?? 0 };
  }

  async close(): Promise<void> {
    await this.sql.end();
  }

  async getTenant(tenantId: string): Promise<Tenant | null> {
    const rows = await this.sql`
      SELECT tenant_id::text, slug, name, kind, status, created_at
      FROM sandboxes.tenants WHERE tenant_id = ${tenantId}::uuid`;
    const row = rows[0] as (Tenant & { created_at: unknown }) | undefined;
    if (!row) return null;
    return { ...row, status: row.status as Tenant["status"], created_at: iso(row.created_at) };
  }

  async upsertTenant(tenant: Tenant): Promise<Tenant> {
    await this.sql`
      INSERT INTO sandboxes.tenants (tenant_id, slug, name, kind, status, created_at)
      VALUES (${tenant.tenant_id}::uuid, ${tenant.slug}, ${tenant.name}, ${tenant.kind}, ${tenant.status}, ${tenant.created_at}::timestamptz)
      ON CONFLICT (tenant_id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name, kind = EXCLUDED.kind, status = EXCLUDED.status`;
    return { ...tenant };
  }

  async getUser(userId: string): Promise<User | null> {
    const rows = await this.sql`
      SELECT user_id::text, user_kind, display_ref, created_at
      FROM sandboxes.users WHERE user_id = ${userId}::uuid`;
    const row = rows[0] as (User & { created_at: unknown }) | undefined;
    if (!row) return null;
    return { ...row, user_kind: row.user_kind as User["user_kind"], created_at: iso(row.created_at) };
  }

  async upsertUser(user: User): Promise<User> {
    await this.sql`
      INSERT INTO sandboxes.users (user_id, user_kind, display_ref, created_at)
      VALUES (${user.user_id}::uuid, ${user.user_kind}, ${user.display_ref}, ${user.created_at}::timestamptz)
      ON CONFLICT (user_id) DO UPDATE SET user_kind = EXCLUDED.user_kind, display_ref = EXCLUDED.display_ref`;
    return { ...user };
  }

  async getMembership(tenantId: string, userId: string): Promise<Membership | null> {
    const rows = await this.sql`
      SELECT tenant_id::text, user_id::text, role
      FROM sandboxes.memberships WHERE tenant_id = ${tenantId}::uuid AND user_id = ${userId}::uuid`;
    const row = rows[0] as Membership | undefined;
    return row ? { ...row, role: row.role as Membership["role"] } : null;
  }

  async upsertMembership(membership: Membership): Promise<Membership> {
    await this.sql`
      INSERT INTO sandboxes.memberships (tenant_id, user_id, role)
      VALUES (${membership.tenant_id}::uuid, ${membership.user_id}::uuid, ${membership.role})
      ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role`;
    return { ...membership };
  }

  async listQuota(tenantId: string): Promise<ProviderQuota[]> {
    const rows = await this.sql`
      SELECT tenant_id::text, adapter_id, max_concurrent, max_monthly_alloc, max_monthly_cost_micros
      FROM sandboxes.tenant_provider_quota WHERE tenant_id = ${tenantId}::uuid`;
    return (rows as ProviderQuota[]).map((r) => ({ ...r, adapter_id: r.adapter_id as ProviderQuota["adapter_id"] }));
  }

  async upsertQuota(quota: ProviderQuota): Promise<ProviderQuota> {
    await this.sql`
      INSERT INTO sandboxes.tenant_provider_quota (tenant_id, adapter_id, max_concurrent, max_monthly_alloc, max_monthly_cost_micros)
      VALUES (${quota.tenant_id}::uuid, ${quota.adapter_id}, ${quota.max_concurrent}, ${quota.max_monthly_alloc}, ${quota.max_monthly_cost_micros})
      ON CONFLICT (tenant_id, adapter_id) DO UPDATE SET
        max_concurrent = EXCLUDED.max_concurrent,
        max_monthly_alloc = EXCLUDED.max_monthly_alloc,
        max_monthly_cost_micros = EXCLUDED.max_monthly_cost_micros`;
    return { ...quota };
  }

  private mapApiKeyRow(row: Record<string, unknown> | undefined): ApiKeyBinding | null {
    if (!row) return null;
    return {
      kid: String(row["kid"]),
      app: String(row["app"]),
      token_hash: String(row["token_hash"]),
      tenant_id: String(row["tenant_id"]),
      user_id: row["user_id"] === null || row["user_id"] === undefined ? null : String(row["user_id"]),
      principal_type: String(row["principal_type"]) as PrincipalType,
      scopes: asStringArray(row["scopes"]),
      issued_at: iso(row["issued_at"]),
      expires_at: isoOrNull(row["expires_at"]),
      revoked_at: isoOrNull(row["revoked_at"]),
    };
  }

  async getApiKeyByHash(tokenHash: string): Promise<ApiKeyBinding | null> {
    const rows = await this.sql`
      SELECT kid, app, token_hash, tenant_id::text, user_id::text, principal_type, scopes, issued_at, expires_at, revoked_at
      FROM sandboxes.api_keys WHERE token_hash = ${tokenHash}`;
    return this.mapApiKeyRow(rows[0] as Record<string, unknown> | undefined);
  }

  async getApiKeyByKid(kid: string): Promise<ApiKeyBinding | null> {
    const rows = await this.sql`
      SELECT kid, app, token_hash, tenant_id::text, user_id::text, principal_type, scopes, issued_at, expires_at, revoked_at
      FROM sandboxes.api_keys WHERE kid = ${kid}`;
    return this.mapApiKeyRow(rows[0] as Record<string, unknown> | undefined);
  }

  async putApiKey(binding: ApiKeyBinding): Promise<ApiKeyBinding> {
    await this.sql`
      INSERT INTO sandboxes.api_keys (kid, app, token_hash, tenant_id, user_id, principal_type, scopes, issued_at, expires_at, revoked_at)
      VALUES (
        ${binding.kid}, ${binding.app}, ${binding.token_hash}, ${binding.tenant_id}::uuid,
        ${binding.user_id}::uuid, ${binding.principal_type}, ${JSON.stringify(binding.scopes)}::jsonb,
        ${binding.issued_at}::timestamptz, ${binding.expires_at}::timestamptz, ${binding.revoked_at}::timestamptz)
      ON CONFLICT (kid) DO UPDATE SET revoked_at = EXCLUDED.revoked_at`;
    return { ...binding, scopes: [...binding.scopes] };
  }

  async revokeApiKey(kid: string, at: string): Promise<void> {
    await this.sql`UPDATE sandboxes.api_keys SET revoked_at = ${at}::timestamptz WHERE kid = ${kid}`;
  }

  async createAllocation(input: NewAllocation): Promise<Allocation> {
    const rows = await this.sql`
      INSERT INTO sandboxes.allocations (
        allocation_id, tenant_id, resource_id, adapter_id, state, spec_sha256, spec,
        requested_by_user_id, state_reason, created_at, updated_at, expires_at, destroyed_at)
      VALUES (
        ${input.allocation_id}, ${input.tenant_id}::uuid, ${null}, ${input.adapter_id}, ${input.state},
        ${input.spec_sha256}, ${JSON.stringify(input.spec)}::jsonb, ${input.requested_by_user_id}::uuid,
        ${input.state_reason}, ${input.created_at}::timestamptz, ${input.created_at}::timestamptz,
        ${input.expires_at}::timestamptz, ${null})
      RETURNING allocation_id, tenant_id::text, resource_id, adapter_id, state, spec_sha256, spec,
        requested_by_user_id::text, state_reason, created_at, updated_at, expires_at, destroyed_at`;
    return rowToAllocation(rows[0] as AllocationRow);
  }

  async getAllocation(tenantId: string, allocationId: string): Promise<Allocation | null> {
    const rows = await this.sql`
      SELECT allocation_id, tenant_id::text, resource_id, adapter_id, state, spec_sha256, spec,
        requested_by_user_id::text, state_reason, created_at, updated_at, expires_at, destroyed_at
      FROM sandboxes.allocations
      WHERE tenant_id = ${tenantId}::uuid AND allocation_id = ${allocationId}`;
    const row = rows[0] as AllocationRow | undefined;
    return row ? rowToAllocation(row) : null;
  }

  async listAllocations(
    tenantId: string,
    opts?: { state?: Allocation["state"]; limit?: number },
  ): Promise<Allocation[]> {
    const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500);
    const rows = opts?.state
      ? await this.sql`
          SELECT allocation_id, tenant_id::text, resource_id, adapter_id, state, spec_sha256, spec,
            requested_by_user_id::text, state_reason, created_at, updated_at, expires_at, destroyed_at
          FROM sandboxes.allocations
          WHERE tenant_id = ${tenantId}::uuid AND state = ${opts.state}
          ORDER BY created_at DESC LIMIT ${limit}`
      : await this.sql`
          SELECT allocation_id, tenant_id::text, resource_id, adapter_id, state, spec_sha256, spec,
            requested_by_user_id::text, state_reason, created_at, updated_at, expires_at, destroyed_at
          FROM sandboxes.allocations
          WHERE tenant_id = ${tenantId}::uuid
          ORDER BY created_at DESC LIMIT ${limit}`;
    return (rows as AllocationRow[]).map(rowToAllocation);
  }

  async updateAllocation(
    tenantId: string,
    allocationId: string,
    patch: AllocationPatch,
    updatedAt: string,
  ): Promise<Allocation | null> {
    const current = await this.getAllocation(tenantId, allocationId);
    if (!current) return null;
    const state = patch.state ?? current.state;
    const stateReason = patch.state_reason !== undefined ? patch.state_reason : current.state_reason;
    const resourceId = patch.resource_id !== undefined ? patch.resource_id : current.resource_id;
    const destroyedAt = patch.destroyed_at !== undefined ? patch.destroyed_at : current.destroyed_at;
    const rows = await this.sql`
      UPDATE sandboxes.allocations
      SET state = ${state}, state_reason = ${stateReason}, resource_id = ${resourceId},
          destroyed_at = ${destroyedAt}::timestamptz, updated_at = ${updatedAt}::timestamptz
      WHERE tenant_id = ${tenantId}::uuid AND allocation_id = ${allocationId}
      RETURNING allocation_id, tenant_id::text, resource_id, adapter_id, state, spec_sha256, spec,
        requested_by_user_id::text, state_reason, created_at, updated_at, expires_at, destroyed_at`;
    const row = rows[0] as AllocationRow | undefined;
    return row ? rowToAllocation(row) : null;
  }

  async countActiveAllocations(tenantId: string, adapterId: Allocation["adapter_id"]): Promise<number> {
    const rows = await this.sql`
      SELECT COUNT(*)::int AS count FROM sandboxes.allocations
      WHERE tenant_id = ${tenantId}::uuid AND adapter_id = ${adapterId}
        AND state IN ('requested','provisioning','active')`;
    const row = rows[0] as { count: number } | undefined;
    return row?.count ?? 0;
  }

  async createCheckpoint(input: NewCheckpoint): Promise<Checkpoint> {
    await this.sql`
      INSERT INTO sandboxes.checkpoints (
        checkpoint_id, tenant_id, allocation_id, s3_key, size_bytes, sha256, label, created_at)
      VALUES (
        ${input.checkpoint_id}, ${input.tenant_id}::uuid, ${input.allocation_id}, ${input.s3_key},
        ${input.size_bytes}, ${input.sha256}, ${input.label}, ${input.created_at}::timestamptz)`;
    return { ...input };
  }

  async getCheckpoint(tenantId: string, checkpointId: string): Promise<Checkpoint | null> {
    const rows = await this.sql`
      SELECT checkpoint_id, tenant_id::text, allocation_id, s3_key, size_bytes, sha256, label, created_at
      FROM sandboxes.checkpoints WHERE tenant_id = ${tenantId}::uuid AND checkpoint_id = ${checkpointId}`;
    const row = rows[0] as (Checkpoint & { created_at: unknown }) | undefined;
    if (!row) return null;
    return { ...row, created_at: iso(row.created_at) };
  }

  async listCheckpoints(tenantId: string, allocationId: string): Promise<Checkpoint[]> {
    const rows = await this.sql`
      SELECT checkpoint_id, tenant_id::text, allocation_id, s3_key, size_bytes, sha256, label, created_at
      FROM sandboxes.checkpoints
      WHERE tenant_id = ${tenantId}::uuid AND allocation_id = ${allocationId}
      ORDER BY created_at DESC`;
    return (rows as Array<Checkpoint & { created_at: unknown }>).map((r) => ({ ...r, created_at: iso(r.created_at) }));
  }
}
