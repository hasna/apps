/**
 * Canonical control-plane DDL (source of truth for the app's migrate step).
 * Mirrored in migrations/self-hosted/0001_control_plane_tenancy.sql for ops.
 *
 * All statements are idempotent (IF NOT EXISTS) and additive. This is a
 * GREENFIELD schema (the deployed sandboxes-prod is a placeholder scaffold with
 * zero real domain rows), so tenant_id columns are NOT NULL at creation — no
 * nullable→backfill→NOT-NULL dance is needed. RLS is intentionally NOT enabled
 * here; it is a discrete deferred step (execution plan, online-safe DDL rule 5).
 */
export const CONTROL_PLANE_DDL: string[] = [
  `CREATE SCHEMA IF NOT EXISTS sandboxes`,

  `CREATE TABLE IF NOT EXISTS sandboxes.tenants (
    tenant_id   UUID PRIMARY KEY,
    slug        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'org' CHECK (kind IN ('root','brand','org','customer')),
    status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS sandboxes.users (
    user_id     UUID PRIMARY KEY,
    user_kind   TEXT NOT NULL CHECK (user_kind IN ('human','agent')),
    display_ref TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS sandboxes.memberships (
    tenant_id   UUID NOT NULL REFERENCES sandboxes.tenants(tenant_id),
    user_id     UUID NOT NULL REFERENCES sandboxes.users(user_id),
    role        TEXT NOT NULL CHECK (role IN ('owner','operator','viewer','agent')),
    PRIMARY KEY (tenant_id, user_id)
  )`,

  `CREATE TABLE IF NOT EXISTS sandboxes.tenant_provider_quota (
    tenant_id               UUID NOT NULL REFERENCES sandboxes.tenants(tenant_id),
    adapter_id              TEXT NOT NULL CHECK (adapter_id IN ('fake','e2b','daytona_cloud')),
    max_concurrent          INTEGER NOT NULL CHECK (max_concurrent >= 0),
    max_monthly_alloc       INTEGER,
    max_monthly_cost_micros BIGINT,
    PRIMARY KEY (tenant_id, adapter_id)
  )`,

  `CREATE TABLE IF NOT EXISTS sandboxes.tenant_provider_credentials (
    tenant_id          UUID NOT NULL REFERENCES sandboxes.tenants(tenant_id),
    adapter_id         TEXT NOT NULL CHECK (adapter_id IN ('e2b','daytona_cloud')),
    installation_id    TEXT NOT NULL,
    provider_scope_ref TEXT NOT NULL,
    secret_ref         TEXT NOT NULL,
    is_shared_pool     BOOLEAN NOT NULL DEFAULT true,
    PRIMARY KEY (tenant_id, adapter_id)
  )`,

  `CREATE TABLE IF NOT EXISTS sandboxes.api_keys (
    kid            TEXT PRIMARY KEY,
    app            TEXT NOT NULL,
    token_hash     TEXT NOT NULL UNIQUE,
    tenant_id      UUID NOT NULL REFERENCES sandboxes.tenants(tenant_id),
    user_id        UUID REFERENCES sandboxes.users(user_id),
    principal_type TEXT NOT NULL CHECK (principal_type IN ('user','service')),
    scopes         JSONB NOT NULL DEFAULT '[]'::jsonb,
    issued_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at     TIMESTAMPTZ,
    revoked_at     TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS sandboxes_api_keys_tenant_idx ON sandboxes.api_keys (tenant_id)`,

  `CREATE TABLE IF NOT EXISTS sandboxes.allocations (
    allocation_id        TEXT PRIMARY KEY,
    tenant_id            UUID NOT NULL REFERENCES sandboxes.tenants(tenant_id),
    resource_id          TEXT,
    adapter_id           TEXT NOT NULL CHECK (adapter_id IN ('fake','e2b','daytona_cloud')),
    state                TEXT NOT NULL CHECK (state IN ('requested','provisioning','active','expired','failed','destroyed')),
    spec_sha256          TEXT NOT NULL,
    spec                 JSONB NOT NULL,
    requested_by_user_id UUID REFERENCES sandboxes.users(user_id),
    state_reason         TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at           TIMESTAMPTZ,
    destroyed_at         TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS sandboxes_allocations_tenant_state_idx ON sandboxes.allocations (tenant_id, state)`,
  `CREATE INDEX IF NOT EXISTS sandboxes_allocations_tenant_adapter_idx ON sandboxes.allocations (tenant_id, adapter_id)`,

  `CREATE TABLE IF NOT EXISTS sandboxes.checkpoints (
    checkpoint_id TEXT PRIMARY KEY,
    tenant_id     UUID NOT NULL REFERENCES sandboxes.tenants(tenant_id),
    allocation_id TEXT NOT NULL REFERENCES sandboxes.allocations(allocation_id),
    s3_key        TEXT,
    size_bytes    BIGINT NOT NULL DEFAULT 0,
    sha256        TEXT NOT NULL,
    label         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS sandboxes_checkpoints_tenant_alloc_idx ON sandboxes.checkpoints (tenant_id, allocation_id)`,
];
