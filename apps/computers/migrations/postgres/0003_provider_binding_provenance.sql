BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS computers_assurance_provider_key ON computers (tenant_id, id, provider);
CREATE UNIQUE INDEX IF NOT EXISTS operations_assurance_computer_key ON operations (tenant_id, id, computer_id);
CREATE UNIQUE INDEX IF NOT EXISTS operation_attempts_assurance_operation_key ON operation_attempts (tenant_id, operation_id, id);

ALTER TABLE provider_bindings DROP CONSTRAINT IF EXISTS provider_bindings_tenant_id_computer_id_fkey;
ALTER TABLE provider_bindings DROP CONSTRAINT IF EXISTS provider_bindings_tenant_id_operation_id_fkey;
ALTER TABLE provider_bindings DROP CONSTRAINT IF EXISTS provider_bindings_attempt_id_fkey;
ALTER TABLE provider_bindings DROP CONSTRAINT IF EXISTS provider_bindings_computer_provider_fkey;
ALTER TABLE provider_bindings DROP CONSTRAINT IF EXISTS provider_bindings_operation_computer_fkey;
ALTER TABLE provider_bindings DROP CONSTRAINT IF EXISTS provider_bindings_attempt_operation_fkey;

ALTER TABLE provider_bindings ADD CONSTRAINT provider_bindings_computer_provider_fkey
  FOREIGN KEY (tenant_id, computer_id, provider) REFERENCES computers (tenant_id, id, provider);
ALTER TABLE provider_bindings ADD CONSTRAINT provider_bindings_operation_computer_fkey
  FOREIGN KEY (tenant_id, operation_id, computer_id) REFERENCES operations (tenant_id, id, computer_id);
ALTER TABLE provider_bindings ADD CONSTRAINT provider_bindings_attempt_operation_fkey
  FOREIGN KEY (tenant_id, operation_id, attempt_id) REFERENCES operation_attempts (tenant_id, operation_id, id);

CREATE INDEX IF NOT EXISTS provider_bindings_operation_idx ON provider_bindings (tenant_id, operation_id, computer_id);
CREATE INDEX IF NOT EXISTS provider_bindings_attempt_idx ON provider_bindings (tenant_id, operation_id, attempt_id);

-- Replace the unconditional (tenant_id, provider, resource_id) uniqueness with a partial unique index
-- that binds only live (active/unknown) authority. Released bindings are retained for provenance and
-- no longer block re-adoption of the same machine:<host> under a new Computer.
ALTER TABLE provider_bindings DROP CONSTRAINT IF EXISTS provider_bindings_tenant_id_provider_resource_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS provider_bindings_active_resource
  ON provider_bindings (tenant_id, provider, resource_id) WHERE state IN ('unknown', 'active');

INSERT INTO schema_migrations(version) VALUES (3) ON CONFLICT DO NOTHING;
COMMIT;
