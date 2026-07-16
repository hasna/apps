BEGIN;

DO $$
DECLARE
  executing_role record;
BEGIN
  SELECT rolname, rolsuper, rolbypassrls INTO executing_role
  FROM pg_roles WHERE rolname = current_user;
  IF NOT FOUND OR NOT (executing_role.rolbypassrls OR executing_role.rolsuper) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'provider-assurance migration requires a dedicated BYPASSRLS migration role';
  END IF;
END $$;

-- This is the global migration order. SHARE ROW EXCLUSIVE excludes application
-- writes for the whole transaction while allowing ordinary read-only traffic.
LOCK TABLE schema_migrations IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE
  computers,
  operations,
  operation_attempts,
  provider_bindings,
  operation_home_leases,
  home_leases,
  resident_bindings,
  resident_enrollments,
  resident_identities,
  resident_nonces,
  profiles,
  profile_revisions
IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
  IF to_regclass('public.provider_assurance') IS NOT NULL THEN
    LOCK TABLE provider_assurance IN SHARE ROW EXCLUSIVE MODE;
  END IF;
END $$;

ALTER TABLE operation_attempts ADD COLUMN IF NOT EXISTS execution_owner_token TEXT;
ALTER TABLE operation_attempts ADD COLUMN IF NOT EXISTS execution_owner_generation bigint NOT NULL DEFAULT 0 CHECK (execution_owner_generation >= 0);
ALTER TABLE operation_attempts ADD COLUMN IF NOT EXISTS execution_owner_expires_at TIMESTAMPTZ;
ALTER TABLE resident_enrollments ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

CREATE TEMP TABLE provider_assurance_demoted_local_vm (
  tenant_id text NOT NULL,
  computer_id text NOT NULL,
  PRIMARY KEY (tenant_id, computer_id)
) ON COMMIT DROP;
INSERT INTO provider_assurance_demoted_local_vm (tenant_id, computer_id)
SELECT tenant_id, id FROM computers
WHERE provider = 'local_vm'
  AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 2);

UPDATE computers c SET confinement_class = 'unverified_vm',
  status = CASE WHEN c.status IN ('deleted','deleting') THEN c.status ELSE 'quarantined' END,
  policy_generation = c.policy_generation + 1, updated_at = now()
FROM provider_assurance_demoted_local_vm d
WHERE c.tenant_id = d.tenant_id AND c.id = d.computer_id;

UPDATE resident_enrollments e SET revoked_at = now() FROM provider_assurance_demoted_local_vm d
WHERE e.tenant_id = d.tenant_id AND e.computer_id = d.computer_id AND e.revoked_at IS NULL;
UPDATE resident_identities i SET revoked_at = now() FROM provider_assurance_demoted_local_vm d
WHERE i.tenant_id = d.tenant_id AND i.computer_id = d.computer_id AND i.revoked_at IS NULL;
DELETE FROM resident_nonces n USING provider_assurance_demoted_local_vm d
WHERE n.tenant_id = d.tenant_id AND n.computer_id = d.computer_id;
DELETE FROM resident_bindings b USING provider_assurance_demoted_local_vm d
WHERE b.tenant_id = d.tenant_id AND b.computer_id = d.computer_id;
DELETE FROM provider_bindings b USING provider_assurance_demoted_local_vm d
WHERE b.tenant_id = d.tenant_id AND b.computer_id = d.computer_id;
DELETE FROM operation_home_leases l USING provider_assurance_demoted_local_vm d
WHERE l.tenant_id = d.tenant_id AND l.computer_id = d.computer_id;
DELETE FROM home_leases l USING provider_assurance_demoted_local_vm d
WHERE l.tenant_id = d.tenant_id AND l.computer_id = d.computer_id;
ALTER TABLE computers DROP CONSTRAINT IF EXISTS computers_local_vm_unverified_check;
ALTER TABLE computers ADD CONSTRAINT computers_local_vm_unverified_check
  CHECK (provider <> 'local_vm' OR confinement_class = 'unverified_vm');

ALTER TABLE profile_revisions DROP CONSTRAINT IF EXISTS profile_revisions_profile_id_fkey;
DO $$
DECLARE primary_key_columns text[];
BEGIN
  SELECT array_agg(attribute.attname ORDER BY key_column.ordinality)
  INTO primary_key_columns
  FROM pg_constraint constraint_record
  CROSS JOIN LATERAL unnest(constraint_record.conkey) WITH ORDINALITY AS key_column(attnum, ordinality)
  JOIN pg_attribute attribute ON attribute.attrelid = constraint_record.conrelid AND attribute.attnum = key_column.attnum
  WHERE constraint_record.conrelid = 'profiles'::regclass AND constraint_record.contype = 'p';
  IF primary_key_columns IS DISTINCT FROM ARRAY['tenant_id', 'id']::text[] THEN
    ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_pkey;
    ALTER TABLE profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (tenant_id, id);
  END IF;
END $$;
ALTER TABLE profile_revisions DROP CONSTRAINT IF EXISTS profile_revisions_tenant_profile_fkey;
ALTER TABLE profile_revisions ADD CONSTRAINT profile_revisions_tenant_profile_fkey
  FOREIGN KEY (tenant_id, profile_id) REFERENCES profiles (tenant_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS operation_attempts_tenant_id_id ON operation_attempts (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS computers_assurance_provider_key ON computers (tenant_id, id, provider);
CREATE UNIQUE INDEX IF NOT EXISTS operations_assurance_computer_key ON operations (tenant_id, id, computer_id);
CREATE UNIQUE INDEX IF NOT EXISTS operation_attempts_assurance_operation_key ON operation_attempts (tenant_id, operation_id, id);

CREATE TABLE IF NOT EXISTS provider_assurance (
  tenant_id text NOT NULL,
  computer_id text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('local_machine', 'local_vm', 'aws_ec2')),
  confinement_class text NOT NULL CHECK (confinement_class IN ('dedicated_machine', 'unverified_vm', 'strict_vm')),
  evidence_json jsonb NOT NULL CHECK (jsonb_typeof(evidence_json) = 'object'),
  operation_id text NOT NULL,
  attempt_id text NOT NULL,
  binding_fence bigint NOT NULL CHECK (binding_fence >= 0),
  generation bigint NOT NULL CHECK (generation > 0),
  verified_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, computer_id)
);

ALTER TABLE provider_assurance DROP CONSTRAINT IF EXISTS provider_assurance_local_vm_unverified_check;
ALTER TABLE provider_assurance ADD CONSTRAINT provider_assurance_local_vm_unverified_check
  CHECK (provider <> 'local_vm' OR confinement_class = 'unverified_vm');
ALTER TABLE provider_assurance DROP CONSTRAINT IF EXISTS provider_assurance_computer_provider_fkey;
ALTER TABLE provider_assurance ADD CONSTRAINT provider_assurance_computer_provider_fkey
  FOREIGN KEY (tenant_id, computer_id, provider) REFERENCES computers (tenant_id, id, provider);
ALTER TABLE provider_assurance DROP CONSTRAINT IF EXISTS provider_assurance_operation_computer_fkey;
ALTER TABLE provider_assurance ADD CONSTRAINT provider_assurance_operation_computer_fkey
  FOREIGN KEY (tenant_id, operation_id, computer_id) REFERENCES operations (tenant_id, id, computer_id);
ALTER TABLE provider_assurance DROP CONSTRAINT IF EXISTS provider_assurance_attempt_operation_fkey;
ALTER TABLE provider_assurance ADD CONSTRAINT provider_assurance_attempt_operation_fkey
  FOREIGN KEY (tenant_id, operation_id, attempt_id) REFERENCES operation_attempts (tenant_id, operation_id, id);

CREATE INDEX IF NOT EXISTS provider_assurance_operation_idx ON provider_assurance (tenant_id, operation_id, computer_id);
CREATE INDEX IF NOT EXISTS provider_assurance_attempt_idx ON provider_assurance (tenant_id, operation_id, attempt_id);

ALTER TABLE provider_assurance ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_assurance FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE provider_assurance FROM PUBLIC;
DROP POLICY IF EXISTS tenant_isolation ON provider_assurance;
CREATE POLICY tenant_isolation ON provider_assurance
  USING (tenant_id = computers_current_tenant())
  WITH CHECK (tenant_id = computers_current_tenant());

INSERT INTO schema_migrations(version) VALUES (2) ON CONFLICT DO NOTHING;
COMMIT;
