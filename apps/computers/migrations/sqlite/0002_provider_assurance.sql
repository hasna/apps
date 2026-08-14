CREATE TEMP TABLE provider_assurance_legacy_local_vm (
  tenant_id TEXT NOT NULL,
  computer_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, computer_id)
);
INSERT INTO provider_assurance_legacy_local_vm (tenant_id, computer_id)
SELECT tenant_id, id FROM computers WHERE provider = 'local_vm';

ALTER TABLE operation_attempts ADD COLUMN execution_owner_token TEXT;
ALTER TABLE operation_attempts ADD COLUMN execution_owner_generation INTEGER NOT NULL DEFAULT 0 CHECK (execution_owner_generation >= 0);
ALTER TABLE operation_attempts ADD COLUMN execution_owner_expires_at TEXT;
ALTER TABLE resident_enrollments ADD COLUMN revoked_at TEXT;

UPDATE resident_enrollments SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE revoked_at IS NULL AND EXISTS (SELECT 1 FROM provider_assurance_legacy_local_vm c WHERE c.tenant_id = resident_enrollments.tenant_id AND c.computer_id = resident_enrollments.computer_id);
UPDATE resident_identities SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE revoked_at IS NULL AND EXISTS (SELECT 1 FROM provider_assurance_legacy_local_vm c WHERE c.tenant_id = resident_identities.tenant_id AND c.computer_id = resident_identities.computer_id);
DELETE FROM resident_nonces WHERE EXISTS (SELECT 1 FROM provider_assurance_legacy_local_vm c WHERE c.tenant_id = resident_nonces.tenant_id AND c.computer_id = resident_nonces.computer_id);
DELETE FROM resident_bindings WHERE EXISTS (SELECT 1 FROM provider_assurance_legacy_local_vm c WHERE c.tenant_id = resident_bindings.tenant_id AND c.computer_id = resident_bindings.computer_id);
DELETE FROM provider_bindings WHERE EXISTS (SELECT 1 FROM provider_assurance_legacy_local_vm c WHERE c.tenant_id = provider_bindings.tenant_id AND c.computer_id = provider_bindings.computer_id);
DELETE FROM operation_home_leases WHERE EXISTS (SELECT 1 FROM provider_assurance_legacy_local_vm c WHERE c.tenant_id = operation_home_leases.tenant_id AND c.computer_id = operation_home_leases.computer_id);
DELETE FROM home_leases WHERE EXISTS (SELECT 1 FROM provider_assurance_legacy_local_vm c WHERE c.tenant_id = home_leases.tenant_id AND c.computer_id = home_leases.computer_id);
UPDATE computers SET confinement_class = 'unverified_vm',
  status = CASE WHEN status IN ('deleted','deleting') THEN status ELSE 'quarantined' END,
  policy_generation = policy_generation + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE EXISTS (SELECT 1 FROM provider_assurance_legacy_local_vm c WHERE c.tenant_id = computers.tenant_id AND c.computer_id = computers.id);

CREATE TRIGGER computers_local_vm_unverified_insert
BEFORE INSERT ON computers WHEN NEW.provider = 'local_vm' AND NEW.confinement_class <> 'unverified_vm'
BEGIN SELECT RAISE(ABORT, 'stock local_vm must remain unverified_vm'); END;
CREATE TRIGGER computers_local_vm_unverified_update
BEFORE UPDATE OF provider, confinement_class ON computers WHEN NEW.provider = 'local_vm' AND NEW.confinement_class <> 'unverified_vm'
BEGIN SELECT RAISE(ABORT, 'stock local_vm must remain unverified_vm'); END;

CREATE TABLE profiles_v2 (
  id TEXT NOT NULL, tenant_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id), UNIQUE (tenant_id, name)
);
INSERT INTO profiles_v2 (id, tenant_id, name, created_at) SELECT id, tenant_id, name, created_at FROM profiles;
CREATE TABLE profile_revisions_v2 (
  id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, tenant_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK (generation > 0),
  digest TEXT NOT NULL CHECK (length(digest) = 71 AND substr(digest, 1, 7) = 'sha256:' AND substr(digest, 8) NOT GLOB '*[^a-f0-9]*'),
  document_json TEXT NOT NULL CHECK (json_valid(document_json) AND json_type(document_json) = 'object'), created_at TEXT NOT NULL,
  UNIQUE (tenant_id, profile_id, generation),
  FOREIGN KEY (tenant_id, profile_id) REFERENCES profiles_v2 (tenant_id, id)
);
INSERT INTO profile_revisions_v2 SELECT id, profile_id, tenant_id, generation, digest, document_json, created_at FROM profile_revisions;
DROP TABLE profile_revisions;
DROP TABLE profiles;
ALTER TABLE profiles_v2 RENAME TO profiles;
ALTER TABLE profile_revisions_v2 RENAME TO profile_revisions;

CREATE UNIQUE INDEX operation_attempts_tenant_id_id ON operation_attempts (tenant_id, id);
CREATE UNIQUE INDEX computers_assurance_provider_key ON computers (tenant_id, id, provider);
CREATE UNIQUE INDEX operations_assurance_computer_key ON operations (tenant_id, id, computer_id);
CREATE UNIQUE INDEX operation_attempts_assurance_operation_key ON operation_attempts (tenant_id, operation_id, id);

CREATE TABLE provider_assurance (
  tenant_id TEXT NOT NULL,
  computer_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('local_machine', 'local_vm', 'aws_ec2')),
  confinement_class TEXT NOT NULL CHECK (confinement_class IN ('dedicated_machine', 'unverified_vm', 'strict_vm') AND (provider <> 'local_vm' OR confinement_class = 'unverified_vm')),
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json) AND json_type(evidence_json) = 'object'),
  operation_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  binding_fence INTEGER NOT NULL CHECK (binding_fence >= 0),
  generation INTEGER NOT NULL CHECK (generation > 0),
  verified_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, computer_id),
  FOREIGN KEY (tenant_id, computer_id, provider) REFERENCES computers (tenant_id, id, provider),
  FOREIGN KEY (tenant_id, operation_id, computer_id) REFERENCES operations (tenant_id, id, computer_id),
  FOREIGN KEY (tenant_id, operation_id, attempt_id) REFERENCES operation_attempts (tenant_id, operation_id, id)
);

CREATE INDEX provider_assurance_operation_idx ON provider_assurance (tenant_id, operation_id, computer_id);
CREATE INDEX provider_assurance_attempt_idx ON provider_assurance (tenant_id, operation_id, attempt_id);
CREATE TRIGGER provider_assurance_local_vm_unverified_insert
BEFORE INSERT ON provider_assurance WHEN NEW.provider = 'local_vm' AND NEW.confinement_class <> 'unverified_vm'
BEGIN SELECT RAISE(ABORT, 'stock local_vm assurance must remain unverified_vm'); END;
CREATE TRIGGER provider_assurance_local_vm_unverified_update
BEFORE UPDATE OF provider, confinement_class ON provider_assurance WHEN NEW.provider = 'local_vm' AND NEW.confinement_class <> 'unverified_vm'
BEGIN SELECT RAISE(ABORT, 'stock local_vm assurance must remain unverified_vm'); END;

DROP TABLE provider_assurance_legacy_local_vm;

INSERT INTO schema_migrations (version, applied_at)
VALUES (2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
