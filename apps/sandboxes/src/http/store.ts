/**
 * Control-plane store for the self-hosted /v1 surface.
 *
 * This is the tenancy-native account/allocation layer that the HTTP API serves.
 * It is intentionally separate from the cryptographic effect-journal domain
 * (service.ts / repository-postgres.ts): the effect journal secures live
 * provider lifecycle (Daytona/E2B dispatch — the R2 boundary), while this store
 * owns the tenant/user/membership/quota + allocation-record + checkpoint-metadata
 * dimension that every /v1 request is scoped by. Every read here REQUIRES a
 * tenantId (no unscoped path is exposed) so cross-tenant access fails closed.
 */
import type { PrincipalType } from "./context.js";

export type StoreBackend = "memory" | "postgres";

export type AllocationState =
  | "requested"
  | "provisioning"
  | "active"
  | "expired"
  | "failed"
  | "destroyed";

export type AdapterId = "fake" | "e2b" | "daytona_cloud";

export interface Tenant {
  tenant_id: string;
  slug: string;
  name: string;
  kind: string;
  status: "active" | "suspended";
  created_at: string;
}

export interface User {
  user_id: string;
  user_kind: "human" | "agent";
  display_ref: string | null;
  created_at: string;
}

export interface Membership {
  tenant_id: string;
  user_id: string;
  role: "owner" | "operator" | "viewer" | "agent";
}

export interface ProviderQuota {
  tenant_id: string;
  adapter_id: AdapterId;
  max_concurrent: number;
  max_monthly_alloc: number | null;
  max_monthly_cost_micros: number | null;
}

export interface ApiKeyBinding {
  kid: string;
  app: string;
  token_hash: string;
  tenant_id: string;
  user_id: string | null;
  principal_type: PrincipalType;
  scopes: string[];
  issued_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

export interface Allocation {
  allocation_id: string;
  tenant_id: string;
  resource_id: string | null;
  adapter_id: AdapterId;
  state: AllocationState;
  spec_sha256: string;
  spec: unknown;
  requested_by_user_id: string | null;
  state_reason: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  destroyed_at: string | null;
}

export interface Checkpoint {
  checkpoint_id: string;
  tenant_id: string;
  allocation_id: string;
  s3_key: string | null;
  size_bytes: number;
  sha256: string;
  label: string | null;
  created_at: string;
}

export interface NewAllocation {
  allocation_id: string;
  tenant_id: string;
  adapter_id: AdapterId;
  spec_sha256: string;
  spec: unknown;
  requested_by_user_id: string | null;
  state: AllocationState;
  state_reason: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface NewCheckpoint {
  checkpoint_id: string;
  tenant_id: string;
  allocation_id: string;
  s3_key: string | null;
  size_bytes: number;
  sha256: string;
  label: string | null;
  created_at: string;
}

export interface AllocationPatch {
  state?: AllocationState;
  state_reason?: string | null;
  resource_id?: string | null;
  destroyed_at?: string | null;
}

export interface ControlPlaneStore {
  readonly backend: StoreBackend;
  migrate(): Promise<void>;
  health(): Promise<{ backend: StoreBackend; ok: boolean; tenants: number; allocations: number }>;
  close(): Promise<void>;

  getTenant(tenantId: string): Promise<Tenant | null>;
  upsertTenant(tenant: Tenant): Promise<Tenant>;

  getUser(userId: string): Promise<User | null>;
  upsertUser(user: User): Promise<User>;

  getMembership(tenantId: string, userId: string): Promise<Membership | null>;
  upsertMembership(membership: Membership): Promise<Membership>;

  listQuota(tenantId: string): Promise<ProviderQuota[]>;
  upsertQuota(quota: ProviderQuota): Promise<ProviderQuota>;

  getApiKeyByHash(tokenHash: string): Promise<ApiKeyBinding | null>;
  getApiKeyByKid(kid: string): Promise<ApiKeyBinding | null>;
  putApiKey(binding: ApiKeyBinding): Promise<ApiKeyBinding>;
  revokeApiKey(kid: string, at: string): Promise<void>;

  createAllocation(input: NewAllocation): Promise<Allocation>;
  getAllocation(tenantId: string, allocationId: string): Promise<Allocation | null>;
  listAllocations(tenantId: string, opts?: { state?: AllocationState; limit?: number }): Promise<Allocation[]>;
  updateAllocation(tenantId: string, allocationId: string, patch: AllocationPatch, updatedAt: string): Promise<Allocation | null>;
  countActiveAllocations(tenantId: string, adapterId: AdapterId): Promise<number>;

  createCheckpoint(input: NewCheckpoint): Promise<Checkpoint>;
  getCheckpoint(tenantId: string, checkpointId: string): Promise<Checkpoint | null>;
  listCheckpoints(tenantId: string, allocationId: string): Promise<Checkpoint[]>;
}
