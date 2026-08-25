/**
 * rc.1 tenancy program, byte-exact (O15-00691).
 *
 * The prod telephony DB ledger (telephony-prod, oss-fleet-prod ECS) was written
 * by the pre-monorepo image @hasnaxyz/telephony 1.0.0-rc.1 (deployed
 * 2026-07-13, ECR prod-20260713-183838-r1rc1, sha256:90af5911...), whose
 * apply-cloud-migrations.mjs applied these statements under
 * telephony_pg_002..003 and telephony_api_keys_tenancy_001 AFTER the current
 * schema program and the contracts api-key migrations. The current build does
 * not apply tenancy from its own schema program, but the ledger downgrade guard
 * refuses every deploy while these rows are unrecognized (observed error:
 * "Applied migration telephony_api_keys_tenancy_001 is not recognized by this
 * build (downgrade?)" — the guard reports the first unknown row in id order).
 * Defining the exact rc.1 statements under the same ids makes the checksums
 * match the applied rows (skipped on prod) and gives fresh installs the same
 * schema the fleet's database was migrated under.
 *
 * APPEND-ONLY: these ids are pinned by tests/fixtures/legacy-ledger-checksums.json
 * (checksums measured from the deployed image's compiled bundles, same
 * checksumSql the storage kit uses). Edit nothing here in place; append new
 * statements under new ids only.
 */
export const LEGACY_TENANCY_AUTHORITY_MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'org',
    status TEXT NOT NULL DEFAULT 'active',
    identity_account_id TEXT,
    metadata TEXT DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    identity_id TEXT UNIQUE,
    email TEXT,
    name TEXT,
    kind TEXT NOT NULL DEFAULT 'human',
    status TEXT NOT NULL DEFAULT 'active',
    metadata TEXT DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS memberships (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member',
    scopes TEXT DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_memberships_tenant ON memberships(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);

  -- FIXED root tenant (slug 'hasna', kind 'root'). Backfill target for every
  -- pre-existing domain row. UUID is the fleet-wide constant ROOT_TENANT_ID.
  INSERT INTO tenants (id, slug, name, kind)
  VALUES ('adfd95c7-ee8b-52cb-ae47-4ae65dae3313', 'hasna', 'Hasna Fleet', 'root')
  ON CONFLICT DO NOTHING;
  `,
];

export const LEGACY_TENANT_COLUMNS_MIGRATIONS: string[] = [
  `
  ALTER TABLE projects ADD COLUMN IF NOT EXISTS tenant_id TEXT;
  ALTER TABLE agents ADD COLUMN IF NOT EXISTS tenant_id TEXT;
  ALTER TABLE sessions ADD COLUMN IF NOT EXISTS tenant_id TEXT;
  ALTER TABLE phone_numbers ADD COLUMN IF NOT EXISTS tenant_id TEXT;
  ALTER TABLE messages ADD COLUMN IF NOT EXISTS tenant_id TEXT;
  ALTER TABLE calls ADD COLUMN IF NOT EXISTS tenant_id TEXT;
  ALTER TABLE voicemails ADD COLUMN IF NOT EXISTS tenant_id TEXT;
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS tenant_id TEXT;
  ALTER TABLE schedules ADD COLUMN IF NOT EXISTS tenant_id TEXT;
  ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS tenant_id TEXT;
  ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS tenant_id TEXT;
  ALTER TABLE feedback ADD COLUMN IF NOT EXISTS tenant_id TEXT;

  UPDATE projects       SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL;
  UPDATE agents         SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL;
  UPDATE sessions       SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL;
  UPDATE phone_numbers  SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL;
  UPDATE messages       SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL;
  UPDATE calls          SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL;
  UPDATE voicemails     SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL;
  UPDATE contacts       SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL;
  UPDATE schedules      SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL;
  UPDATE webhooks       SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL;
  UPDATE webhook_events SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL;

  CREATE INDEX IF NOT EXISTS idx_messages_tenant ON messages(tenant_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_calls_tenant ON calls(tenant_id, started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_voicemails_tenant ON voicemails(tenant_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_contacts_tenant ON contacts(tenant_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_phone_numbers_tenant ON phone_numbers(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_agents_tenant ON agents(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_projects_tenant ON projects(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_schedules_tenant ON schedules(tenant_id);
  `,
];

/** Additive bridge that extends the contracts-owned `api_keys` table with the
 * transition bridge columns (kid -> tenant_id, user_id, principal_type). */
export const API_KEYS_TENANCY_BRIDGE_SQL = `
  ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS tenant_id UUID;
  ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS user_id UUID;
  ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS principal_type TEXT;
  CREATE INDEX IF NOT EXISTS api_keys_kid_bridge_idx ON api_keys (kid);
`;
