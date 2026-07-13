-- projects-serve tenancy migration (R1 — ADDITIVE, online-safe).
--
-- Implements Auth & Tenancy Standard v2 for projects, R1 phase only:
--   * new tables: tenants, users, memberships, api_key_context (the kid->tenant
--     bridge). tenants/users/memberships are the local mirror; identities is the
--     fleet authority.
--   * tenant_id UUID (NULLABLE) added to every domain table + backfilled to the
--     fixed ROOT tenant adfd95c7-ee8b-52cb-ae47-4ae65dae3313 (slug 'hasna').
--   * per-table tenant_id index for scoped scans.
--   * api_key_context backfilled from api_keys (when that table already exists).
--
-- INTENTIONALLY NOT DONE HERE (R2 flip — see _EXECUTION-PLAN.md):
--   * NO `SET NOT NULL`, NO FK validation on tenant_id (columns stay nullable).
--   * NO RLS enable / FORCE, NO composite-unique swap (global uniques stay).
--   * NO fail-closed enforcement. Enabling any of these is a separate release.
--
-- Data-volume note: the projects registry is small (roots/agents/recipes/
-- workspaces + their events). Columns are added nullable (instant, no rewrite);
-- the backfill touches a modest row count in the migration's change window.

-- --- new tenancy tables (local mirror + bridge) ---------------------------

CREATE TABLE IF NOT EXISTS tenants (
  id          UUID PRIMARY KEY,
  slug        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'org',       -- 'root' | 'brand' | 'org' | 'customer'
  status      TEXT NOT NULL DEFAULT 'active',
  identity_id TEXT,                              -- optional link to the identities org card
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id           UUID PRIMARY KEY,
  external_id  TEXT,                             -- identities subject / kid owner
  kind         TEXT NOT NULL DEFAULT 'service',  -- 'human' | 'agent' | 'service'
  handle       TEXT,
  email        TEXT,
  display_name TEXT,
  status       TEXT NOT NULL DEFAULT 'active',
  metadata     JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  id             BIGSERIAL PRIMARY KEY,
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  user_id        UUID NOT NULL REFERENCES users(id),
  principal_type TEXT NOT NULL DEFAULT 'user',   -- 'user' | 'service'
  role           TEXT NOT NULL DEFAULT 'member', -- owner|admin|member|viewer|agent|service
  scopes         JSONB NOT NULL DEFAULT '[]',
  status         TEXT NOT NULL DEFAULT 'active',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, principal_type)
);

-- The kid -> (tenant_id, user_id) bridge. Populated by identities at key mint;
-- backfilled here for pre-existing keys. Resolved server-side per request.
CREATE TABLE IF NOT EXISTS api_key_context (
  kid            TEXT PRIMARY KEY,
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  user_id        UUID REFERENCES users(id),
  principal_type TEXT NOT NULL DEFAULT 'service',
  scopes         JSONB NOT NULL DEFAULT '[]',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_key_context_tenant_idx ON api_key_context (tenant_id);

-- --- seed the fixed ROOT tenant + system principal ------------------------

INSERT INTO tenants (id, slug, name, kind)
VALUES ('adfd95c7-ee8b-52cb-ae47-4ae65dae3313', 'hasna', 'Hasna', 'root')
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, external_id, kind, handle, display_name)
VALUES ('00000000-0000-0000-0000-000000000000', 'system', 'service', 'system', 'System')
ON CONFLICT (id) DO NOTHING;

INSERT INTO memberships (tenant_id, user_id, principal_type, role)
VALUES ('adfd95c7-ee8b-52cb-ae47-4ae65dae3313', '00000000-0000-0000-0000-000000000000', 'service', 'owner')
ON CONFLICT (tenant_id, user_id, principal_type) DO NOTHING;

-- --- add nullable tenant_id to every domain table + backfill to ROOT ------

ALTER TABLE roots                   ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE recipes                 ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE agents                  ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE tmux_profiles           ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE workspaces              ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE workspace_locations     ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE workspace_agents        ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE workspace_events        ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE agent_runs              ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE project_budgets         ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE project_budget_spend    ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE tmux_profile_windows    ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE workspace_tmux_sessions ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE workspace_locks         ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE workspace_migration_map ADD COLUMN IF NOT EXISTS tenant_id UUID;

UPDATE roots                   SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL;
UPDATE recipes                 SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL;
UPDATE agents                  SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL;
UPDATE tmux_profiles           SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL;
UPDATE workspaces              SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL;
UPDATE workspace_locations     SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL;
UPDATE workspace_agents        SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL;
UPDATE workspace_events        SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL;
UPDATE agent_runs              SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL;
UPDATE project_budgets         SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL;
UPDATE project_budget_spend    SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL;
UPDATE tmux_profile_windows    SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL;
UPDATE workspace_tmux_sessions SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL;
UPDATE workspace_locks         SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL;
UPDATE workspace_migration_map SET tenant_id = 'adfd95c7-ee8b-52cb-ae47-4ae65dae3313' WHERE tenant_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_roots_tenant                   ON roots (tenant_id);
CREATE INDEX IF NOT EXISTS idx_recipes_tenant                 ON recipes (tenant_id);
CREATE INDEX IF NOT EXISTS idx_agents_tenant                  ON agents (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tmux_profiles_tenant           ON tmux_profiles (tenant_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_tenant              ON workspaces (tenant_id);
CREATE INDEX IF NOT EXISTS idx_workspace_locations_tenant     ON workspace_locations (tenant_id);
CREATE INDEX IF NOT EXISTS idx_workspace_agents_tenant        ON workspace_agents (tenant_id);
CREATE INDEX IF NOT EXISTS idx_workspace_events_tenant        ON workspace_events (tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant              ON agent_runs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_project_budgets_tenant         ON project_budgets (tenant_id);
CREATE INDEX IF NOT EXISTS idx_project_budget_spend_tenant    ON project_budget_spend (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tmux_profile_windows_tenant    ON tmux_profile_windows (tenant_id);
CREATE INDEX IF NOT EXISTS idx_workspace_tmux_sessions_tenant ON workspace_tmux_sessions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_workspace_locks_tenant         ON workspace_locks (tenant_id);
CREATE INDEX IF NOT EXISTS idx_workspace_migration_map_tenant ON workspace_migration_map (tenant_id);

-- --- backfill the kid bridge for pre-existing api keys (if api_keys exists) --
-- api_keys is created by the @hasna/contracts auth migrations. On prod it is
-- already applied before this migration runs; on a fresh DB it applies after,
-- so guard the backfill and let unbound keys resolve to ROOT (R1 non-fail-closed).
DO $backfill_keys$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'api_keys') THEN
    INSERT INTO api_key_context (kid, tenant_id, user_id, principal_type, scopes)
    SELECT k.kid,
           'adfd95c7-ee8b-52cb-ae47-4ae65dae3313'::uuid,
           '00000000-0000-0000-0000-000000000000'::uuid,
           'service',
           COALESCE(k.scopes, '[]'::jsonb)
    FROM api_keys k
    ON CONFLICT (kid) DO NOTHING;
  END IF;
END
$backfill_keys$;
