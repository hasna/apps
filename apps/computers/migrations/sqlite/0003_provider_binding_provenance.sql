CREATE TABLE provider_bindings_v3 (
  tenant_id TEXT NOT NULL,
  computer_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('local_machine', 'local_vm', 'aws_ec2')),
  resource_id TEXT NOT NULL,
  instance_id TEXT,
  boot_id TEXT,
  operation_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('unknown', 'active', 'released')),
  fence INTEGER NOT NULL CHECK (fence >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, computer_id),
  FOREIGN KEY (tenant_id, computer_id, provider) REFERENCES computers (tenant_id, id, provider),
  FOREIGN KEY (tenant_id, operation_id, computer_id) REFERENCES operations (tenant_id, id, computer_id),
  FOREIGN KEY (tenant_id, operation_id, attempt_id) REFERENCES operation_attempts (tenant_id, operation_id, id)
);

INSERT INTO provider_bindings_v3
  (tenant_id, computer_id, provider, resource_id, instance_id, boot_id, operation_id, attempt_id, state, fence, updated_at)
SELECT tenant_id, computer_id, provider, resource_id, instance_id, boot_id, operation_id, attempt_id, state, fence, updated_at
FROM provider_bindings;

DROP TABLE provider_bindings;
ALTER TABLE provider_bindings_v3 RENAME TO provider_bindings;
CREATE INDEX provider_bindings_operation_idx ON provider_bindings (tenant_id, operation_id, computer_id);
CREATE INDEX provider_bindings_attempt_idx ON provider_bindings (tenant_id, operation_id, attempt_id);
-- One live (active/unknown) authority per physical resource, but released bindings are retained for
-- provenance without blocking re-adoption of the same machine:<host> under a new Computer.
CREATE UNIQUE INDEX provider_bindings_active_resource ON provider_bindings (tenant_id, provider, resource_id) WHERE state IN ('unknown', 'active');

INSERT INTO schema_migrations (version, applied_at)
VALUES (3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
