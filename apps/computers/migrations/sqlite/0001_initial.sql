CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS computers (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('local_machine', 'local_vm', 'aws_ec2')),
  confinement_class TEXT NOT NULL CHECK (
    (provider = 'local_machine' AND confinement_class = 'dedicated_machine') OR
    (provider IN ('local_vm', 'aws_ec2') AND confinement_class IN ('unverified_vm', 'strict_vm'))
  ),
  status TEXT NOT NULL CHECK (status IN ('provisioning', 'stopped', 'running', 'quarantined', 'deleting', 'deleted', 'error')),
  owner_principal_id TEXT NOT NULL,
  policy_generation INTEGER NOT NULL DEFAULT 1 CHECK (policy_generation > 0),
  data_exfiltration_protection INTEGER NOT NULL CHECK (data_exfiltration_protection IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, slug)
);

CREATE UNIQUE INDEX IF NOT EXISTS computers_one_active_owner
  ON computers (tenant_id, owner_principal_id)
  WHERE status NOT IN ('deleted', 'deleting');

CREATE TABLE IF NOT EXISTS computer_create_grants (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  owner_principal_id TEXT NOT NULL,
  parent_computer_id TEXT NOT NULL,
  allowed_providers_json TEXT NOT NULL CHECK (
    json_valid(allowed_providers_json) AND json_type(allowed_providers_json) = 'array' AND
    json_array_length(allowed_providers_json) BETWEEN 1 AND 3 AND
    allowed_providers_json IN (
      '["local_machine"]', '["local_vm"]', '["aws_ec2"]',
      '["local_machine","local_vm"]', '["local_machine","aws_ec2"]', '["local_vm","aws_ec2"]',
      '["local_machine","local_vm","aws_ec2"]'
    )
  ),
  allowed_child_owners_json TEXT NOT NULL CHECK (json_valid(allowed_child_owners_json) AND json_type(allowed_child_owners_json) = 'array' AND json_array_length(allowed_child_owners_json) BETWEEN 1 AND 128),
  allowed_regions_json TEXT NOT NULL CHECK (json_valid(allowed_regions_json) AND json_type(allowed_regions_json) = 'array' AND json_array_length(allowed_regions_json) BETWEEN 1 AND 32),
  allowed_profile_ids_json TEXT NOT NULL CHECK (json_valid(allowed_profile_ids_json) AND json_type(allowed_profile_ids_json) = 'array' AND json_array_length(allowed_profile_ids_json) BETWEEN 1 AND 64),
  max_storage_gib INTEGER NOT NULL CHECK (max_storage_gib BETWEEN 1 AND 1048576),
  max_uptime_seconds INTEGER NOT NULL CHECK (max_uptime_seconds BETWEEN 1 AND 31536000),
  max_budget_micros INTEGER NOT NULL CHECK (max_budget_micros BETWEEN 0 AND 9007199254740991),
  limit_count INTEGER NOT NULL CHECK (limit_count BETWEEN 1 AND 1000),
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  generation INTEGER NOT NULL CHECK (generation > 0),
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, principal_id, owner_principal_id, parent_computer_id, allowed_providers_json, generation),
  FOREIGN KEY (tenant_id, parent_computer_id) REFERENCES computers (tenant_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS computer_create_grants_one_active
  ON computer_create_grants (tenant_id, principal_id, owner_principal_id, parent_computer_id, allowed_providers_json)
  WHERE active = 1;

CREATE TABLE IF NOT EXISTS child_reservations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  parent_computer_id TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  child_computer_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('reserved', 'active', 'released')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, grant_id, idempotency_key),
  UNIQUE (tenant_id, child_computer_id),
  FOREIGN KEY (tenant_id, parent_computer_id) REFERENCES computers (tenant_id, id),
  FOREIGN KEY (tenant_id, grant_id) REFERENCES computer_create_grants (tenant_id, id),
  FOREIGN KEY (tenant_id, child_computer_id) REFERENCES computers (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  computer_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  generation INTEGER NOT NULL CHECK (generation > 0),
  created_at TEXT NOT NULL,
  ended_at TEXT,
  FOREIGN KEY (tenant_id, computer_id) REFERENCES computers (tenant_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS assignments_active_computer
  ON assignments (tenant_id, computer_id) WHERE active = 1;
CREATE UNIQUE INDEX IF NOT EXISTS assignments_active_principal
  ON assignments (tenant_id, principal_id) WHERE active = 1;

CREATE TABLE IF NOT EXISTS idempotency_keys (
  tenant_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 71 AND substr(request_hash, 1, 7) = 'sha256:' AND substr(request_hash, 8) NOT GLOB '*[^a-f0-9]*'),
  response_json TEXT NOT NULL CHECK (json_valid(response_json)),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, namespace, idempotency_key)
);

CREATE TABLE IF NOT EXISTS operations (
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  computer_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('create', 'start', 'stop', 'quarantine', 'delete', 'exec', 'install', 'snapshot', 'restore')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'running', 'unknown', 'succeeded', 'failed', 'cancelled')),
  policy_generation INTEGER NOT NULL CHECK (policy_generation > 0),
  idempotency_key TEXT NOT NULL,
  request_json TEXT NOT NULL CHECK (json_valid(request_json) AND json_type(request_json) = 'object'),
  prior_computer_status TEXT CHECK (prior_computer_status IS NULL OR prior_computer_status IN ('provisioning', 'stopped', 'running', 'quarantined', 'deleting', 'deleted', 'error')),
  desired_computer_status TEXT CHECK (desired_computer_status IS NULL OR desired_computer_status IN ('provisioning', 'stopped', 'running', 'quarantined', 'deleting', 'deleted', 'error')),
  result_json TEXT CHECK (result_json IS NULL OR (json_valid(result_json) AND json_type(result_json) = 'object')),
  error_code TEXT,
  fence INTEGER NOT NULL DEFAULT 0 CHECK (fence >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, computer_id, kind, idempotency_key),
  FOREIGN KEY (tenant_id, computer_id) REFERENCES computers (tenant_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS operations_one_active_lifecycle
  ON operations (tenant_id, computer_id)
  WHERE kind IN ('create', 'start', 'stop', 'quarantine', 'delete', 'restore')
    AND status IN ('pending', 'accepted', 'running', 'unknown');

CREATE TABLE IF NOT EXISTS operation_attempts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  provider_idempotency_key TEXT NOT NULL,
  provider_operation_id TEXT,
  resource_json TEXT CHECK (resource_json IS NULL OR (json_valid(resource_json) AND json_type(resource_json) = 'object')),
  status TEXT NOT NULL CHECK (status IN ('running', 'unknown', 'succeeded', 'failed')),
  fence INTEGER NOT NULL CHECK (fence >= 0),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (tenant_id, operation_id, attempt_number),
  UNIQUE (tenant_id, provider_idempotency_key),
  FOREIGN KEY (tenant_id, operation_id) REFERENCES operations (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS provider_bindings (
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
  UNIQUE (tenant_id, provider, resource_id),
  FOREIGN KEY (tenant_id, computer_id) REFERENCES computers (tenant_id, id),
  FOREIGN KEY (tenant_id, operation_id) REFERENCES operations (tenant_id, id),
  FOREIGN KEY (attempt_id) REFERENCES operation_attempts (id)
);

CREATE TABLE IF NOT EXISTS operation_home_leases (
  tenant_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  computer_id TEXT NOT NULL,
  home_id TEXT NOT NULL,
  holder_id TEXT NOT NULL,
  fence INTEGER NOT NULL CHECK (fence > 0),
  expires_at TEXT NOT NULL,
  CHECK (home_id = 'home:' || computer_id),
  PRIMARY KEY (tenant_id, operation_id),
  FOREIGN KEY (tenant_id, operation_id) REFERENCES operations (tenant_id, id),
  FOREIGN KEY (tenant_id, computer_id) REFERENCES computers (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS home_leases (
  tenant_id TEXT NOT NULL,
  computer_id TEXT NOT NULL,
  holder_id TEXT NOT NULL,
  fence INTEGER NOT NULL CHECK (fence > 0),
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, computer_id),
  FOREIGN KEY (tenant_id, computer_id) REFERENCES computers (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS resident_enrollments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  computer_id TEXT NOT NULL,
  expected_provider TEXT NOT NULL CHECK (expected_provider IN ('local_machine', 'local_vm', 'aws_ec2')),
  expected_instance_id TEXT NOT NULL,
  expected_boot_id TEXT NOT NULL,
  binding_generation INTEGER NOT NULL CHECK (binding_generation > 0),
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^a-f0-9]*'),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id, computer_id) REFERENCES computers (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS resident_bindings (
  tenant_id TEXT NOT NULL,
  computer_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('local_machine', 'local_vm', 'aws_ec2')),
  provider_resource_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  boot_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK (generation > 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, computer_id),
  UNIQUE (tenant_id, provider, provider_resource_id),
  FOREIGN KEY (tenant_id, computer_id) REFERENCES computers (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS resident_identities (
  certificate_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  computer_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('local_machine', 'local_vm', 'aws_ec2')),
  instance_id TEXT NOT NULL,
  boot_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK (generation > 0),
  binding_generation INTEGER NOT NULL CHECK (binding_generation > 0),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (tenant_id, computer_id) REFERENCES computers (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS resident_nonces (
  tenant_id TEXT NOT NULL,
  computer_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, computer_id, nonce),
  UNIQUE (tenant_id, computer_id, operation_id, attempt_id, sequence)
);

CREATE TABLE IF NOT EXISTS install_policy_revisions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  computer_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK (generation > 0),
  digest TEXT NOT NULL CHECK (length(digest) = 71 AND substr(digest, 1, 7) = 'sha256:' AND substr(digest, 8) NOT GLOB '*[^a-f0-9]*'),
  rules_json TEXT NOT NULL CHECK (json_valid(rules_json) AND json_type(rules_json) = 'array'),
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, computer_id, generation),
  UNIQUE (tenant_id, computer_id, digest),
  FOREIGN KEY (tenant_id, computer_id) REFERENCES computers (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS install_tickets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  computer_id TEXT NOT NULL,
  policy_revision_id TEXT NOT NULL,
  policy_generation INTEGER NOT NULL CHECK (policy_generation > 0),
  policy_digest TEXT NOT NULL CHECK (length(policy_digest) = 71 AND substr(policy_digest, 1, 7) = 'sha256:' AND substr(policy_digest, 8) NOT GLOB '*[^a-f0-9]*'),
  spec_digest TEXT NOT NULL CHECK (length(spec_digest) = 71 AND substr(spec_digest, 1, 7) = 'sha256:' AND substr(spec_digest, 8) NOT GLOB '*[^a-f0-9]*'),
  claims_json TEXT NOT NULL CHECK (json_valid(claims_json) AND json_type(claims_json) = 'object'),
  signature TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, nonce),
  FOREIGN KEY (policy_revision_id) REFERENCES install_policy_revisions (id),
  FOREIGN KEY (tenant_id, computer_id) REFERENCES computers (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS volumes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  computer_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('root', 'home')),
  provider_ref TEXT,
  fence INTEGER NOT NULL DEFAULT 0 CHECK (fence >= 0),
  state TEXT NOT NULL CHECK (state IN ('pending', 'attached', 'detached', 'quarantined', 'deleted', 'error')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, computer_id, kind),
  FOREIGN KEY (tenant_id, computer_id) REFERENCES computers (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  computer_id TEXT NOT NULL,
  volume_id TEXT,
  provider_ref TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'failed', 'deleted')),
  quarantine_status TEXT NOT NULL DEFAULT 'pending' CHECK (quarantine_status IN ('pending', 'clean', 'quarantined', 'failed')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id, computer_id) REFERENCES computers (tenant_id, id),
  FOREIGN KEY (volume_id) REFERENCES volumes (id)
);

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS profile_revisions (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK (generation > 0),
  digest TEXT NOT NULL CHECK (length(digest) = 71 AND substr(digest, 1, 7) = 'sha256:' AND substr(digest, 8) NOT GLOB '*[^a-f0-9]*'),
  document_json TEXT NOT NULL CHECK (json_valid(document_json) AND json_type(document_json) = 'object'),
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, profile_id, generation),
  FOREIGN KEY (profile_id) REFERENCES profiles (id)
);

CREATE TABLE IF NOT EXISTS grants (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  computer_id TEXT,
  scopes_json TEXT NOT NULL CHECK (json_valid(scopes_json) AND json_type(scopes_json) = 'array'),
  policy_generation INTEGER CHECK (policy_generation IS NULL OR policy_generation > 0),
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^a-f0-9]*'),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS controller_keys (
  name TEXT PRIMARY KEY,
  key_material BLOB NOT NULL CHECK (length(key_material) >= 32),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL,
  actor_principal_id TEXT NOT NULL,
  computer_id TEXT,
  action TEXT NOT NULL,
  data_json TEXT NOT NULL CHECK (json_valid(data_json) AND json_type(data_json) = 'object'),
  previous_hash TEXT NOT NULL CHECK (length(previous_hash) = 71 AND substr(previous_hash, 1, 7) = 'sha256:' AND substr(previous_hash, 8) NOT GLOB '*[^a-f0-9]*'),
  event_hash TEXT NOT NULL UNIQUE CHECK (length(event_hash) = 71 AND substr(event_hash, 1, 7) = 'sha256:' AND substr(event_hash, 8) NOT GLOB '*[^a-f0-9]*'),
  created_at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS audit_events_no_update
BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit_events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_events_no_delete
BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit_events are append-only'); END;

CREATE TABLE IF NOT EXISTS outbox_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json) AND json_type(payload_json) = 'object'),
  created_at TEXT NOT NULL,
  published_at TEXT
);

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
