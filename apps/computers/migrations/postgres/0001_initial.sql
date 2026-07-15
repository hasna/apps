BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version bigint PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS computers (
  tenant_id text NOT NULL,
  id text NOT NULL,
  slug text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('local_machine', 'local_vm', 'aws_ec2')),
  confinement_class text NOT NULL CHECK (
    (provider = 'local_machine' AND confinement_class = 'dedicated_machine') OR
    (provider IN ('local_vm', 'aws_ec2') AND confinement_class IN ('unverified_vm', 'strict_vm'))
  ),
  status text NOT NULL CHECK (status IN ('provisioning', 'stopped', 'running', 'quarantined', 'deleting', 'deleted', 'error')),
  owner_principal_id text NOT NULL,
  policy_generation bigint NOT NULL DEFAULT 1 CHECK (policy_generation > 0),
  data_exfiltration_protection boolean NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, slug)
);
CREATE UNIQUE INDEX IF NOT EXISTS computers_one_active_owner ON computers (tenant_id, owner_principal_id)
WHERE status NOT IN ('deleted', 'deleting');

CREATE TABLE IF NOT EXISTS computer_create_grants (
  tenant_id text NOT NULL, id text NOT NULL, principal_id text NOT NULL, owner_principal_id text NOT NULL,
  parent_computer_id text NOT NULL, allowed_providers text[] NOT NULL,
  allowed_child_owner_principal_ids text[] NOT NULL CHECK (cardinality(allowed_child_owner_principal_ids) BETWEEN 1 AND 128),
  allowed_regions text[] NOT NULL CHECK (cardinality(allowed_regions) BETWEEN 1 AND 32),
  allowed_profile_ids text[] NOT NULL CHECK (cardinality(allowed_profile_ids) BETWEEN 1 AND 64),
  max_storage_gib integer NOT NULL CHECK (max_storage_gib BETWEEN 1 AND 1048576),
  max_uptime_seconds integer NOT NULL CHECK (max_uptime_seconds BETWEEN 1 AND 31536000),
  max_budget_micros bigint NOT NULL CHECK (max_budget_micros BETWEEN 0 AND 9007199254740991),
  limit_count integer NOT NULL CHECK (limit_count BETWEEN 1 AND 1000), active boolean NOT NULL,
  generation bigint NOT NULL CHECK (generation > 0), expires_at timestamptz,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, principal_id, owner_principal_id, parent_computer_id, allowed_providers, generation),
  CHECK (allowed_providers IN (
    ARRAY['local_machine']::text[], ARRAY['local_vm']::text[], ARRAY['aws_ec2']::text[],
    ARRAY['local_machine','local_vm']::text[], ARRAY['local_machine','aws_ec2']::text[], ARRAY['local_vm','aws_ec2']::text[],
    ARRAY['local_machine','local_vm','aws_ec2']::text[]
  )),
  FOREIGN KEY (tenant_id, parent_computer_id) REFERENCES computers (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS computer_create_grants_one_active
  ON computer_create_grants (tenant_id, principal_id, owner_principal_id, parent_computer_id, allowed_providers) WHERE active;

CREATE TABLE IF NOT EXISTS child_reservations (
  id text PRIMARY KEY, tenant_id text NOT NULL, parent_computer_id text NOT NULL,
  child_computer_id text NOT NULL, grant_id text NOT NULL, idempotency_key text NOT NULL,
  state text NOT NULL CHECK (state IN ('reserved', 'active', 'released')),
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id, grant_id, idempotency_key), UNIQUE (tenant_id, child_computer_id),
  FOREIGN KEY (tenant_id, parent_computer_id) REFERENCES computers (tenant_id, id),
  FOREIGN KEY (tenant_id, grant_id) REFERENCES computer_create_grants (tenant_id, id),
  FOREIGN KEY (tenant_id, child_computer_id) REFERENCES computers (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS assignments (
  id text PRIMARY KEY, tenant_id text NOT NULL, computer_id text NOT NULL, principal_id text NOT NULL,
  active boolean NOT NULL, generation bigint NOT NULL CHECK (generation > 0), created_at timestamptz NOT NULL, ended_at timestamptz,
  FOREIGN KEY (tenant_id, computer_id) REFERENCES computers (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS assignments_active_computer ON assignments (tenant_id, computer_id) WHERE active;
CREATE UNIQUE INDEX IF NOT EXISTS assignments_active_principal ON assignments (tenant_id, principal_id) WHERE active;

CREATE TABLE IF NOT EXISTS idempotency_keys (
  tenant_id text NOT NULL, namespace text NOT NULL, idempotency_key text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[a-f0-9]{64}$'), response_json jsonb NOT NULL, created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL, PRIMARY KEY (tenant_id, namespace, idempotency_key)
);

CREATE TABLE IF NOT EXISTS operations (
  tenant_id text NOT NULL, id text NOT NULL, computer_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('create', 'start', 'stop', 'quarantine', 'delete', 'exec', 'install', 'snapshot', 'restore')),
  status text NOT NULL CHECK (status IN ('pending', 'accepted', 'running', 'unknown', 'succeeded', 'failed', 'cancelled')),
  policy_generation bigint NOT NULL CHECK (policy_generation > 0), idempotency_key text NOT NULL,
  request_json jsonb NOT NULL CHECK (jsonb_typeof(request_json) = 'object'),
  prior_computer_status text CHECK (prior_computer_status IS NULL OR prior_computer_status IN ('provisioning', 'stopped', 'running', 'quarantined', 'deleting', 'deleted', 'error')),
  desired_computer_status text CHECK (desired_computer_status IS NULL OR desired_computer_status IN ('provisioning', 'stopped', 'running', 'quarantined', 'deleting', 'deleted', 'error')),
  result_json jsonb CHECK (result_json IS NULL OR jsonb_typeof(result_json) = 'object'), error_code text, fence bigint NOT NULL DEFAULT 0 CHECK (fence >= 0),
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id), UNIQUE (tenant_id, computer_id, kind, idempotency_key),
  FOREIGN KEY (tenant_id, computer_id) REFERENCES computers (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS operations_one_active_lifecycle
  ON operations (tenant_id, computer_id)
  WHERE kind IN ('create', 'start', 'stop', 'quarantine', 'delete', 'restore')
    AND status IN ('pending', 'accepted', 'running', 'unknown');

CREATE TABLE IF NOT EXISTS operation_attempts (
  id text PRIMARY KEY, tenant_id text NOT NULL, operation_id text NOT NULL, attempt_number integer NOT NULL CHECK (attempt_number > 0),
  provider_idempotency_key text NOT NULL, provider_operation_id text, resource_json jsonb,
  status text NOT NULL CHECK (status IN ('running','unknown','succeeded','failed')), fence bigint NOT NULL CHECK (fence >= 0), started_at timestamptz NOT NULL,
  completed_at timestamptz, UNIQUE (tenant_id, operation_id, attempt_number), UNIQUE (tenant_id, provider_idempotency_key),
  FOREIGN KEY (tenant_id, operation_id) REFERENCES operations (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS provider_bindings (
  tenant_id text NOT NULL, computer_id text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('local_machine', 'local_vm', 'aws_ec2')),
  resource_id text NOT NULL, instance_id text, boot_id text,
  operation_id text NOT NULL, attempt_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('unknown', 'active', 'released')),
  fence bigint NOT NULL CHECK (fence >= 0), updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, computer_id), UNIQUE (tenant_id, provider, resource_id),
  FOREIGN KEY (tenant_id, computer_id) REFERENCES computers (tenant_id, id),
  FOREIGN KEY (tenant_id, operation_id) REFERENCES operations (tenant_id, id),
  FOREIGN KEY (attempt_id) REFERENCES operation_attempts (id)
);

CREATE TABLE IF NOT EXISTS operation_home_leases (
  tenant_id text NOT NULL, operation_id text NOT NULL, computer_id text NOT NULL, home_id text NOT NULL,
  holder_id text NOT NULL, fence bigint NOT NULL CHECK (fence > 0), expires_at timestamptz NOT NULL,
  CHECK (home_id = 'home:' || computer_id),
  PRIMARY KEY (tenant_id, operation_id), FOREIGN KEY (tenant_id, operation_id) REFERENCES operations (tenant_id, id),
  FOREIGN KEY (tenant_id, computer_id) REFERENCES computers (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS home_leases (
  tenant_id text NOT NULL, computer_id text NOT NULL, holder_id text NOT NULL, fence bigint NOT NULL CHECK (fence > 0),
  expires_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, PRIMARY KEY (tenant_id, computer_id),
  FOREIGN KEY (tenant_id, computer_id) REFERENCES computers (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS resident_enrollments (
  id text PRIMARY KEY, tenant_id text NOT NULL, computer_id text NOT NULL, expected_provider text NOT NULL,
  expected_instance_id text NOT NULL, token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
  expected_boot_id text NOT NULL, binding_generation bigint NOT NULL CHECK (binding_generation > 0),
  used_at timestamptz, created_at timestamptz NOT NULL,
  CHECK (expected_provider IN ('local_machine','local_vm','aws_ec2')),
  CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  FOREIGN KEY (tenant_id, computer_id) REFERENCES computers (tenant_id, id)
);
CREATE TABLE IF NOT EXISTS resident_bindings (
  tenant_id text NOT NULL, computer_id text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('local_machine','local_vm','aws_ec2')),
  provider_resource_id text NOT NULL, instance_id text NOT NULL, boot_id text NOT NULL,
  generation bigint NOT NULL CHECK (generation > 0), updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, computer_id), UNIQUE (tenant_id, provider, provider_resource_id),
  FOREIGN KEY (tenant_id, computer_id) REFERENCES computers (tenant_id, id)
);
CREATE TABLE IF NOT EXISTS resident_identities (
  certificate_id text PRIMARY KEY, tenant_id text NOT NULL, computer_id text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('local_machine','local_vm','aws_ec2')),
  instance_id text NOT NULL, boot_id text NOT NULL, generation bigint NOT NULL CHECK (generation > 0), issued_at timestamptz NOT NULL,
  binding_generation bigint NOT NULL CHECK (binding_generation > 0), expires_at timestamptz NOT NULL, revoked_at timestamptz,
  FOREIGN KEY (tenant_id, computer_id) REFERENCES computers (tenant_id, id)
);
CREATE TABLE IF NOT EXISTS resident_nonces (
  tenant_id text NOT NULL, computer_id text NOT NULL, nonce text NOT NULL, operation_id text NOT NULL,
  attempt_id text NOT NULL, sequence bigint NOT NULL CHECK (sequence >= 0), expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, computer_id, nonce), UNIQUE (tenant_id, computer_id, operation_id, attempt_id, sequence)
);

CREATE TABLE IF NOT EXISTS install_policy_revisions (
  id text PRIMARY KEY, tenant_id text NOT NULL, computer_id text NOT NULL, generation bigint NOT NULL CHECK (generation > 0),
  digest text NOT NULL CHECK (digest ~ '^sha256:[a-f0-9]{64}$'), rules_json jsonb NOT NULL CHECK (jsonb_typeof(rules_json) = 'array'), created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, computer_id, generation), UNIQUE (tenant_id, computer_id, digest),
  FOREIGN KEY (tenant_id, computer_id) REFERENCES computers (tenant_id, id)
);
CREATE TABLE IF NOT EXISTS install_tickets (
  id text PRIMARY KEY, tenant_id text NOT NULL, computer_id text NOT NULL, policy_revision_id text NOT NULL,
  policy_generation bigint NOT NULL CHECK (policy_generation > 0),
  policy_digest text NOT NULL CHECK (policy_digest ~ '^sha256:[a-f0-9]{64}$'),
  spec_digest text NOT NULL CHECK (spec_digest ~ '^sha256:[a-f0-9]{64}$'),
  claims_json jsonb NOT NULL, signature text NOT NULL, nonce text NOT NULL, expires_at timestamptz NOT NULL,
  consumed_at timestamptz, created_at timestamptz NOT NULL, UNIQUE (tenant_id, nonce),
  FOREIGN KEY (policy_revision_id) REFERENCES install_policy_revisions (id),
  FOREIGN KEY (tenant_id, computer_id) REFERENCES computers (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS volumes (
  id text PRIMARY KEY, tenant_id text NOT NULL, computer_id text NOT NULL, kind text NOT NULL CHECK (kind IN ('root','home')),
  provider_ref text, fence bigint NOT NULL DEFAULT 0 CHECK (fence >= 0), state text NOT NULL CHECK (state IN ('pending','attached','detached','quarantined','deleted','error')),
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id, computer_id, kind), FOREIGN KEY (tenant_id, computer_id) REFERENCES computers (tenant_id, id)
);
CREATE TABLE IF NOT EXISTS snapshots (
  id text PRIMARY KEY, tenant_id text NOT NULL, computer_id text NOT NULL, volume_id text,
  provider_ref text, status text NOT NULL CHECK (status IN ('pending','ready','failed','deleted')),
  quarantine_status text NOT NULL DEFAULT 'pending' CHECK (quarantine_status IN ('pending','clean','quarantined','failed')), created_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, computer_id) REFERENCES computers (tenant_id, id), FOREIGN KEY (volume_id) REFERENCES volumes (id)
);
CREATE TABLE IF NOT EXISTS profiles (
  id text PRIMARY KEY, tenant_id text NOT NULL, name text NOT NULL, created_at timestamptz NOT NULL, UNIQUE (tenant_id, name)
);
CREATE TABLE IF NOT EXISTS profile_revisions (
  id text PRIMARY KEY, profile_id text NOT NULL REFERENCES profiles(id), tenant_id text NOT NULL,
  generation bigint NOT NULL CHECK (generation > 0), digest text NOT NULL CHECK (digest ~ '^sha256:[a-f0-9]{64}$'), document_json jsonb NOT NULL, created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, profile_id, generation)
);
CREATE TABLE IF NOT EXISTS grants (
  id text PRIMARY KEY, tenant_id text NOT NULL, principal_id text NOT NULL, computer_id text,
  scopes_json jsonb NOT NULL CHECK (jsonb_typeof(scopes_json) = 'array'),
  policy_generation bigint CHECK (policy_generation IS NULL OR policy_generation > 0), expires_at timestamptz, revoked_at timestamptz, created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY, tenant_id text NOT NULL, principal_id text NOT NULL, token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_events (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, id text NOT NULL UNIQUE, tenant_id text NOT NULL,
  actor_principal_id text NOT NULL, computer_id text, action text NOT NULL, data_json jsonb NOT NULL,
  previous_hash text NOT NULL CHECK (previous_hash ~ '^sha256:[a-f0-9]{64}$'),
  event_hash text NOT NULL UNIQUE CHECK (event_hash ~ '^sha256:[a-f0-9]{64}$'), created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS outbox_events (
  id text PRIMARY KEY, tenant_id text NOT NULL, topic text NOT NULL, payload_json jsonb NOT NULL CHECK (jsonb_typeof(payload_json) = 'object'),
  created_at timestamptz NOT NULL, published_at timestamptz
);

-- The migration role owns schema changes. The application role must be separate,
-- non-owner, receive only explicit DML grants, and set computers.tenant_id locally
-- inside each transaction. Missing or empty tenant state denies every RLS policy.
CREATE OR REPLACE FUNCTION computers_current_tenant() RETURNS text LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT NULLIF(current_setting('computers.tenant_id', true), '')
$$;
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['computers','computer_create_grants','child_reservations','assignments','idempotency_keys','operations','operation_attempts','provider_bindings','operation_home_leases','home_leases','resident_bindings','resident_enrollments','resident_identities','resident_nonces','install_policy_revisions','install_tickets','volumes','snapshots','profiles','profile_revisions','grants','sessions','audit_events','outbox_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = computers_current_tenant()) WITH CHECK (tenant_id = computers_current_tenant())', table_name);
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION computers_current_tenant() FROM PUBLIC;

-- Before an application adapter can connect, an operator must explicitly grant its
-- NOINHERIT, NOSUPERUSER, NOBYPASSRLS application role DML on the tables above and
-- EXECUTE on computers_current_tenant(). The migrator/owner role must never be used
-- by the application. This migration intentionally grants no runtime role access.

-- PostgreSQL controllers MUST provide an external persistent signing-key provider.
-- No controller key table is created here; runtime PostgreSQL support is unready.

CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_events are append-only'; END $$;
DROP TRIGGER IF EXISTS audit_events_no_update ON audit_events;
DROP TRIGGER IF EXISTS audit_events_no_delete ON audit_events;
CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

INSERT INTO schema_migrations(version) VALUES (1) ON CONFLICT DO NOTHING;
COMMIT;
