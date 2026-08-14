-- @generated mirror of POSTGRES_STORAGE_MIGRATIONS["0013_loop_mutation_contract"] — DO NOT EDIT.
-- Source of truth: src/lib/storage/postgres-schema.ts
-- Runner: loops-serve migrate  (checksum: sha256:eb35e8d593628f2d7a2449dddf60b28e6ffc42f87ff694441262aa2794e78913)

GRANT USAGE, CREATE ON SCHEMA public TO open_loops_owner;
SET ROLE open_loops_owner;

CREATE TABLE loop_mutation_operations (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  operation_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  binding_digest TEXT NOT NULL,
  binding_json JSONB NOT NULL,
  admission_json JSONB NOT NULL,
  terminal_json JSONB NOT NULL,
  result_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, operation_id, step_id)
);
CREATE INDEX idx_loop_mutation_target
  ON loop_mutation_operations(tenant_id, target_id, created_at DESC);

CREATE TABLE loop_mutation_leases (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  target_id TEXT NOT NULL,
  lease_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, target_id),
  UNIQUE (tenant_id, lease_id)
);

ALTER TABLE loop_mutation_operations OWNER TO open_loops_owner;
ALTER TABLE loop_mutation_leases OWNER TO open_loops_owner;
ALTER TABLE loop_mutation_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE loop_mutation_operations FORCE ROW LEVEL SECURITY;
ALTER TABLE loop_mutation_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE loop_mutation_leases FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON loop_mutation_operations
  USING (tenant_id = open_loops_current_tenant_id())
  WITH CHECK (tenant_id = open_loops_current_tenant_id());
CREATE POLICY tenant_isolation ON loop_mutation_leases
  USING (tenant_id = open_loops_current_tenant_id())
  WITH CHECK (tenant_id = open_loops_current_tenant_id());
GRANT SELECT, INSERT ON loop_mutation_operations TO open_loops_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON loop_mutation_leases TO open_loops_runtime;

RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM open_loops_owner;
GRANT USAGE ON SCHEMA public TO open_loops_owner;
