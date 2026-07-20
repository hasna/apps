-- @generated mirror of POSTGRES_STORAGE_MIGRATIONS["0008_tenant_prepare"] — DO NOT EDIT.
-- Source of truth: src/lib/storage/postgres-schema.ts
-- Runner: loops-serve migrate  (checksum: sha256:76924f61f71fa2e7d3fb7773ff372200e26d0b3e48a5d05585adaeeca8f30043)

CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE principals (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('human', 'service', 'machine')),
  display_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tenant_memberships (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  principal_id TEXT NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, principal_id)
);

CREATE TABLE tenant_roles (
  name TEXT PRIMARY KEY CHECK (name IN ('admin', 'operator', 'member', 'readonly', 'service', 'worker'))
);
INSERT INTO tenant_roles(name) VALUES ('admin'), ('operator'), ('member'), ('readonly'), ('service'), ('worker');

CREATE TABLE tenant_membership_roles (
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL REFERENCES tenant_roles(name),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, principal_id, role),
  FOREIGN KEY (tenant_id, principal_id) REFERENCES tenant_memberships(tenant_id, principal_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS api_keys (
  kid TEXT PRIMARY KEY,
  app TEXT NOT NULL,
  agent TEXT,
  scopes JSONB NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT,
  last_used_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE api_keys ADD COLUMN tenant_id TEXT;
ALTER TABLE api_keys ADD COLUMN principal_id TEXT;
ALTER TABLE api_keys ADD COLUMN token_kind TEXT;
ALTER TABLE api_keys ADD COLUMN disabled_at TIMESTAMPTZ;

ALTER TABLE loops ADD COLUMN tenant_id TEXT;
ALTER TABLE loop_runs ADD COLUMN tenant_id TEXT;
ALTER TABLE daemon_lease ADD COLUMN tenant_id TEXT;
ALTER TABLE workflow_specs ADD COLUMN tenant_id TEXT;
ALTER TABLE workflow_runs ADD COLUMN tenant_id TEXT;
ALTER TABLE workflow_invocations ADD COLUMN tenant_id TEXT;
ALTER TABLE workflow_work_items ADD COLUMN tenant_id TEXT;
ALTER TABLE workflow_step_runs ADD COLUMN tenant_id TEXT;
ALTER TABLE workflow_events ADD COLUMN tenant_id TEXT;
ALTER TABLE goals ADD COLUMN tenant_id TEXT;
ALTER TABLE goal_plan_nodes ADD COLUMN tenant_id TEXT;
ALTER TABLE goal_runs ADD COLUMN tenant_id TEXT;
ALTER TABLE runner_machines ADD COLUMN tenant_id TEXT;
ALTER TABLE runner_leases ADD COLUMN tenant_id TEXT;
ALTER TABLE audit_events ADD COLUMN tenant_id TEXT;
ALTER TABLE audit_events ADD COLUMN principal_id TEXT;
ALTER TABLE audit_events ADD COLUMN request_id TEXT;
ALTER TABLE audit_events ADD COLUMN operation_id TEXT;
ALTER TABLE audit_events ADD COLUMN decision TEXT;
ALTER TABLE audit_events ADD COLUMN deny_reason TEXT;
ALTER TABLE run_receipts ADD COLUMN tenant_id TEXT;

CREATE TABLE tenant_row_assignments (
  table_name TEXT NOT NULL,
  row_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  PRIMARY KEY (table_name, row_id),
  CHECK (table_name IN (
    'loops', 'loop_runs', 'daemon_lease', 'workflow_specs', 'workflow_runs',
    'workflow_invocations', 'workflow_work_items', 'workflow_step_runs', 'workflow_events',
    'goals', 'goal_plan_nodes', 'goal_runs', 'runner_machines', 'runner_leases',
    'audit_events', 'run_receipts'
  ))
);

CREATE TABLE api_key_tenant_bindings (
  kid TEXT PRIMARY KEY REFERENCES api_keys(kid) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  token_kind TEXT NOT NULL CHECK (token_kind IN ('api_key', 'service', 'machine')),
  FOREIGN KEY (tenant_id, principal_id) REFERENCES tenant_memberships(tenant_id, principal_id)
);

CREATE TABLE preauth_audit_events (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  deny_reason TEXT NOT NULL,
  metadata_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
