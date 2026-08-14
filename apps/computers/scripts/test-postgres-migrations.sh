#!/usr/bin/env bash
set -euo pipefail

command -v psql >/dev/null

suffix="${$}"
prefix="computers_t1ba992db_${suffix}"
database="${prefix}_main"
rollback_database="${prefix}_rollback"
rollback3_database="${prefix}_rollback3"
concurrent_database="${prefix}_concurrent"
role_failure_database="${prefix}_role_failure"
writer_database="${prefix}_writer"
temp_directory="$(mktemp -d)"
migration_role="${prefix}_migrator"
rejected_migration_role="${prefix}_rejected_migrator"
application_role="${prefix}_app"
proof_wait_timeout_seconds="${POSTGRES_MIGRATION_PROOF_TIMEOUT_SECONDS:-60}"
background_pids=()
background_input_fds=()

migrator_psql() {
  PGOPTIONS="-c role=$migration_role" psql "$@"
}

rejected_migrator_psql() {
  PGOPTIONS="-c role=$rejected_migration_role" psql "$@"
}

cleanup() {
  set +e
  for descriptor in "${background_input_fds[@]}"; do
    eval "exec ${descriptor}>&-" 2>/dev/null || true
  done
  for name in "$database" "$rollback_database" "$rollback3_database" "$concurrent_database" "$role_failure_database" "$writer_database"; do
    psql -X -q -d postgres -v ON_ERROR_STOP=1 -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$name' AND pid <> pg_backend_pid();" >/dev/null 2>&1
    psql -X -q -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $name;" >/dev/null 2>&1
  done
  for pid in "${background_pids[@]}"; do
    kill "$pid" >/dev/null 2>&1 || true
  done
  for pid in "${background_pids[@]}"; do
    wait "$pid" >/dev/null 2>&1 || true
  done
  psql -X -q -d postgres -v ON_ERROR_STOP=1 -c "DROP ROLE IF EXISTS $application_role;" >/dev/null 2>&1
  psql -X -q -d postgres -v ON_ERROR_STOP=1 -c "DROP ROLE IF EXISTS $rejected_migration_role;" >/dev/null 2>&1
  psql -X -q -d postgres -v ON_ERROR_STOP=1 -c "DROP ROLE IF EXISTS $migration_role;" >/dev/null 2>&1
  rm -rf "$temp_directory"
}
trap cleanup EXIT INT TERM

wait_for_sql_true() {
  local target_database="$1"
  local description="$2"
  local query="$3"
  local deadline=$((SECONDS + proof_wait_timeout_seconds))

  while ((SECONDS < deadline)); do
    if [[ "$(psql -X -qAt -d "$target_database" -v ON_ERROR_STOP=1 -c "$query")" == "t" ]]; then
      return 0
    fi
    sleep 0.1
  done

  echo "timed out waiting for $description" >&2
  psql -X -q -d "$target_database" -v ON_ERROR_STOP=1 -c "SELECT pid, application_name, state, wait_event_type, wait_event FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE '${prefix}_%';" >&2 || true
  return 1
}

server_version_num="$(psql -X -qAt -d postgres -v ON_ERROR_STOP=1 -c "SHOW server_version_num;")"
[[ "$server_version_num" == "160013" ]]

psql -X -q -d postgres -v ON_ERROR_STOP=1 -c "CREATE ROLE $migration_role LOGIN NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;"
psql -X -q -d postgres -v ON_ERROR_STOP=1 -c "CREATE ROLE $rejected_migration_role LOGIN NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;"
psql -X -q -d postgres -v ON_ERROR_STOP=1 -c "CREATE ROLE $application_role LOGIN NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;"
role_state="$(psql -X -qAt -d postgres -v ON_ERROR_STOP=1 -c "SELECT string_agg(rolname || ':' || rolsuper::text || ':' || rolbypassrls::text, ',' ORDER BY rolname) FROM pg_roles WHERE rolname IN ('$migration_role','$rejected_migration_role','$application_role');")"
[[ "$role_state" == "$application_role:false:false,$migration_role:false:true,$rejected_migration_role:false:false" ]]

psql -X -q -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $database OWNER $migration_role;"
migrator_psql -X -q -d "$database" -v ON_ERROR_STOP=1 -f migrations/postgres/0001_initial.sql
migrator_psql -X -q -d "$database" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO computers (tenant_id,id,slug,provider,confinement_class,status,owner_principal_id,policy_generation,data_exfiltration_protection,created_at,updated_at)
VALUES ('tenant_pg_a','cmp_pg_vm','pg-vm','local_vm','strict_vm','running','principal_pg',1,false,now(),now());
INSERT INTO operations (tenant_id,id,computer_id,kind,status,policy_generation,idempotency_key,request_json,fence,created_at,updated_at)
VALUES ('tenant_pg_a','opn_pg_vm','cmp_pg_vm','create','running',1,'pg-create','{}',0,now(),now());
INSERT INTO operation_attempts (id,tenant_id,operation_id,attempt_number,provider_idempotency_key,status,fence,started_at)
VALUES ('pat_pg_vm','tenant_pg_a','opn_pg_vm',1,'provider:opn_pg_vm','running',0,now());
INSERT INTO home_leases (tenant_id,computer_id,holder_id,fence,expires_at,updated_at)
VALUES ('tenant_pg_a','cmp_pg_vm','holder_pg',1,now() + interval '1 hour',now());
INSERT INTO operation_home_leases (tenant_id,operation_id,computer_id,home_id,holder_id,fence,expires_at)
VALUES ('tenant_pg_a','opn_pg_vm','cmp_pg_vm','home:cmp_pg_vm','holder_pg',1,now() + interval '1 hour');
INSERT INTO resident_bindings (tenant_id,computer_id,provider,provider_resource_id,instance_id,boot_id,generation,updated_at)
VALUES ('tenant_pg_a','cmp_pg_vm','local_vm','resource_pg','instance_pg','boot_pg',1,now());
INSERT INTO resident_enrollments (id,tenant_id,computer_id,expected_provider,expected_instance_id,expected_boot_id,binding_generation,token_hash,expires_at,created_at)
VALUES ('ren_pg_vm','tenant_pg_a','cmp_pg_vm','local_vm','instance_pg','boot_pg',1,repeat('a',64),now() + interval '1 hour',now());
INSERT INTO resident_identities (certificate_id,tenant_id,computer_id,provider,instance_id,boot_id,generation,binding_generation,issued_at,expires_at)
VALUES ('cert_pg_vm','tenant_pg_a','cmp_pg_vm','local_vm','instance_pg','boot_pg',1,1,now(),now() + interval '1 hour');
INSERT INTO resident_nonces (tenant_id,computer_id,nonce,operation_id,attempt_id,sequence,expires_at,created_at)
VALUES ('tenant_pg_a','cmp_pg_vm','nonce_pg_legacy','opn_pg_vm','pat_pg_vm',0,now() + interval '1 hour',now());
INSERT INTO provider_bindings (tenant_id,computer_id,provider,resource_id,operation_id,attempt_id,state,fence,updated_at)
VALUES ('tenant_pg_a','cmp_pg_vm','local_vm','resource_pg_legacy','opn_pg_vm','pat_pg_vm','active',0,now());
INSERT INTO computers (tenant_id,id,slug,provider,confinement_class,status,owner_principal_id,policy_generation,data_exfiltration_protection,created_at,updated_at)
VALUES ('tenant_pg_legacy_unverified','cmp_pg_legacy_unverified','pg-legacy-unverified','local_vm','unverified_vm','running','principal_pg_legacy_unverified',1,false,now(),now());
INSERT INTO operations (tenant_id,id,computer_id,kind,status,policy_generation,idempotency_key,request_json,fence,created_at,updated_at)
VALUES ('tenant_pg_legacy_unverified','opn_pg_legacy_unverified','cmp_pg_legacy_unverified','create','running',1,'pg-create-legacy-unverified','{}',0,now(),now());
INSERT INTO operation_attempts (id,tenant_id,operation_id,attempt_number,provider_idempotency_key,status,fence,started_at)
VALUES ('pat_pg_legacy_unverified','tenant_pg_legacy_unverified','opn_pg_legacy_unverified',1,'provider:opn_pg_legacy_unverified','running',0,now());
INSERT INTO home_leases (tenant_id,computer_id,holder_id,fence,expires_at,updated_at)
VALUES ('tenant_pg_legacy_unverified','cmp_pg_legacy_unverified','holder_pg_legacy_unverified',1,now() + interval '1 hour',now());
INSERT INTO operation_home_leases (tenant_id,operation_id,computer_id,home_id,holder_id,fence,expires_at)
VALUES ('tenant_pg_legacy_unverified','opn_pg_legacy_unverified','cmp_pg_legacy_unverified','home:cmp_pg_legacy_unverified','holder_pg_legacy_unverified',1,now() + interval '1 hour');
INSERT INTO resident_bindings (tenant_id,computer_id,provider,provider_resource_id,instance_id,boot_id,generation,updated_at)
VALUES ('tenant_pg_legacy_unverified','cmp_pg_legacy_unverified','local_vm','resource_pg_legacy_unverified','instance_pg_legacy_unverified','boot_pg_legacy_unverified',1,now());
INSERT INTO resident_enrollments (id,tenant_id,computer_id,expected_provider,expected_instance_id,expected_boot_id,binding_generation,token_hash,expires_at,created_at)
VALUES ('ren_pg_legacy_unverified','tenant_pg_legacy_unverified','cmp_pg_legacy_unverified','local_vm','instance_pg_legacy_unverified','boot_pg_legacy_unverified',1,repeat('b',64),now() + interval '1 hour',now());
INSERT INTO resident_identities (certificate_id,tenant_id,computer_id,provider,instance_id,boot_id,generation,binding_generation,issued_at,expires_at)
VALUES ('cert_pg_legacy_unverified','tenant_pg_legacy_unverified','cmp_pg_legacy_unverified','local_vm','instance_pg_legacy_unverified','boot_pg_legacy_unverified',1,1,now(),now() + interval '1 hour');
INSERT INTO resident_nonces (tenant_id,computer_id,nonce,operation_id,attempt_id,sequence,expires_at,created_at)
VALUES ('tenant_pg_legacy_unverified','cmp_pg_legacy_unverified','nonce_pg_legacy_unverified','opn_pg_legacy_unverified','pat_pg_legacy_unverified',0,now() + interval '1 hour',now());
INSERT INTO provider_bindings (tenant_id,computer_id,provider,resource_id,operation_id,attempt_id,state,fence,updated_at)
VALUES ('tenant_pg_legacy_unverified','cmp_pg_legacy_unverified','local_vm','resource_pg_legacy_unverified_binding','opn_pg_legacy_unverified','pat_pg_legacy_unverified','active',0,now());
INSERT INTO computers (tenant_id,id,slug,provider,confinement_class,status,owner_principal_id,policy_generation,data_exfiltration_protection,created_at,updated_at)
VALUES
  ('tenant_pg_terminal','cmp_pg_deleted','pg-deleted','local_vm','unverified_vm','deleted','principal_pg_deleted',1,false,now(),now()),
  ('tenant_pg_terminal','cmp_pg_deleting','pg-deleting','local_vm','unverified_vm','deleting','principal_pg_deleting',1,false,now(),now());
INSERT INTO computers (tenant_id,id,slug,provider,confinement_class,status,owner_principal_id,policy_generation,data_exfiltration_protection,created_at,updated_at)
VALUES
  ('tenant_pg_status','cmp_pg_provisioning','pg-provisioning','local_vm','strict_vm','provisioning','principal_pg_provisioning',3,false,now(),now()),
  ('tenant_pg_status','cmp_pg_stopped','pg-stopped','local_vm','unverified_vm','stopped','principal_pg_stopped',5,false,now(),now()),
  ('tenant_pg_status','cmp_pg_quarantined','pg-quarantined','local_vm','strict_vm','quarantined','principal_pg_quarantined',7,false,now(),now()),
  ('tenant_pg_status','cmp_pg_error','pg-error','local_vm','unverified_vm','error','principal_pg_error',9,false,now(),now());
INSERT INTO operations (tenant_id,id,computer_id,kind,status,policy_generation,idempotency_key,request_json,fence,created_at,updated_at)
VALUES
  ('tenant_pg_terminal','opn_pg_deleted','cmp_pg_deleted','delete','running',1,'pg-delete-terminal','{}',0,now(),now()),
  ('tenant_pg_terminal','opn_pg_deleting','cmp_pg_deleting','delete','running',1,'pg-deleting-terminal','{}',0,now(),now());
INSERT INTO operation_attempts (id,tenant_id,operation_id,attempt_number,provider_idempotency_key,status,fence,started_at)
VALUES
  ('pat_pg_deleted','tenant_pg_terminal','opn_pg_deleted',1,'provider:opn_pg_deleted','running',0,now()),
  ('pat_pg_deleting','tenant_pg_terminal','opn_pg_deleting',1,'provider:opn_pg_deleting','running',0,now());
INSERT INTO home_leases (tenant_id,computer_id,holder_id,fence,expires_at,updated_at)
VALUES
  ('tenant_pg_terminal','cmp_pg_deleted','holder_pg_deleted',1,now() + interval '1 hour',now()),
  ('tenant_pg_terminal','cmp_pg_deleting','holder_pg_deleting',1,now() + interval '1 hour',now());
INSERT INTO operation_home_leases (tenant_id,operation_id,computer_id,home_id,holder_id,fence,expires_at)
VALUES
  ('tenant_pg_terminal','opn_pg_deleted','cmp_pg_deleted','home:cmp_pg_deleted','holder_pg_deleted',1,now() + interval '1 hour'),
  ('tenant_pg_terminal','opn_pg_deleting','cmp_pg_deleting','home:cmp_pg_deleting','holder_pg_deleting',1,now() + interval '1 hour');
INSERT INTO resident_bindings (tenant_id,computer_id,provider,provider_resource_id,instance_id,boot_id,generation,updated_at)
VALUES
  ('tenant_pg_terminal','cmp_pg_deleted','local_vm','resource_pg_deleted','instance_pg_deleted','boot_pg_deleted',1,now()),
  ('tenant_pg_terminal','cmp_pg_deleting','local_vm','resource_pg_deleting','instance_pg_deleting','boot_pg_deleting',1,now());
INSERT INTO resident_enrollments (id,tenant_id,computer_id,expected_provider,expected_instance_id,expected_boot_id,binding_generation,token_hash,expires_at,created_at)
VALUES
  ('ren_pg_deleted','tenant_pg_terminal','cmp_pg_deleted','local_vm','instance_pg_deleted','boot_pg_deleted',1,repeat('e',64),now() + interval '1 hour',now()),
  ('ren_pg_deleting','tenant_pg_terminal','cmp_pg_deleting','local_vm','instance_pg_deleting','boot_pg_deleting',1,repeat('d',64),now() + interval '1 hour',now());
INSERT INTO resident_identities (certificate_id,tenant_id,computer_id,provider,instance_id,boot_id,generation,binding_generation,issued_at,expires_at)
VALUES
  ('cert_pg_deleted','tenant_pg_terminal','cmp_pg_deleted','local_vm','instance_pg_deleted','boot_pg_deleted',1,1,now(),now() + interval '1 hour'),
  ('cert_pg_deleting','tenant_pg_terminal','cmp_pg_deleting','local_vm','instance_pg_deleting','boot_pg_deleting',1,1,now(),now() + interval '1 hour');
INSERT INTO resident_nonces (tenant_id,computer_id,nonce,operation_id,attempt_id,sequence,expires_at,created_at)
VALUES
  ('tenant_pg_terminal','cmp_pg_deleted','nonce_pg_deleted','opn_pg_deleted','pat_pg_deleted',0,now() + interval '1 hour',now()),
  ('tenant_pg_terminal','cmp_pg_deleting','nonce_pg_deleting','opn_pg_deleting','pat_pg_deleting',0,now() + interval '1 hour',now());
INSERT INTO provider_bindings (tenant_id,computer_id,provider,resource_id,operation_id,attempt_id,state,fence,updated_at)
VALUES
  ('tenant_pg_terminal','cmp_pg_deleted','local_vm','resource_pg_deleted_binding','opn_pg_deleted','pat_pg_deleted','active',0,now()),
  ('tenant_pg_terminal','cmp_pg_deleting','local_vm','resource_pg_deleting_binding','opn_pg_deleting','pat_pg_deleting','active',0,now());
INSERT INTO profiles (id,tenant_id,name,created_at) VALUES ('profile_shared','tenant_pg_a','Shared A',now());
INSERT INTO profile_revisions (id,profile_id,tenant_id,generation,digest,document_json,created_at)
VALUES ('prv_pg_a','profile_shared','tenant_pg_a',1,'sha256:' || repeat('a',64),'{}',now());
SQL
migrator_psql -X -q -d "$database" -v ON_ERROR_STOP=1 -f migrations/postgres/0002_provider_assurance.sql
legacy_provider_authority_state="$(migrator_psql -X -qAt -d "$database" -v ON_ERROR_STOP=1 -c "SELECT
  (SELECT count(*) FROM provider_bindings WHERE computer_id IN ('cmp_pg_vm','cmp_pg_legacy_unverified','cmp_pg_deleted','cmp_pg_deleting'))::text || ':' ||
  (SELECT count(*) FROM resident_nonces WHERE computer_id IN ('cmp_pg_vm','cmp_pg_legacy_unverified','cmp_pg_deleted','cmp_pg_deleting'))::text;")"
[[ "$legacy_provider_authority_state" == "0:0" ]]
migrator_psql -X -q -d "$database" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO provider_bindings
  (tenant_id,computer_id,provider,resource_id,instance_id,boot_id,operation_id,attempt_id,state,fence,updated_at)
VALUES ('tenant_pg_a','cmp_pg_vm','local_vm','resource_pg','instance_pg','boot_pg','opn_pg_vm','pat_pg_vm','active',0,now());
SQL
migrator_psql -X -q -d "$database" -v ON_ERROR_STOP=1 -f migrations/postgres/0003_provider_binding_provenance.sql

migrator_psql -X -q -d "$database" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF (SELECT max(version) FROM schema_migrations) <> 3 THEN RAISE EXCEPTION 'schema version is not 3'; END IF;
  IF NOT EXISTS (SELECT 1 FROM computers WHERE tenant_id='tenant_pg_a' AND id='cmp_pg_vm' AND confinement_class='unverified_vm' AND status='quarantined' AND policy_generation=2) THEN
    RAISE EXCEPTION 'legacy local_vm was not demoted';
  END IF;
  IF EXISTS (SELECT 1 FROM resident_bindings WHERE computer_id='cmp_pg_vm') OR EXISTS (SELECT 1 FROM home_leases WHERE computer_id='cmp_pg_vm')
    OR EXISTS (SELECT 1 FROM operation_home_leases WHERE computer_id='cmp_pg_vm') THEN RAISE EXCEPTION 'legacy authority survived'; END IF;
  IF EXISTS (SELECT 1 FROM resident_enrollments WHERE id='ren_pg_vm' AND revoked_at IS NULL)
    OR EXISTS (SELECT 1 FROM resident_identities WHERE certificate_id='cert_pg_vm' AND revoked_at IS NULL) THEN RAISE EXCEPTION 'resident credentials survived'; END IF;
  IF NOT EXISTS (SELECT 1 FROM computers WHERE tenant_id='tenant_pg_legacy_unverified' AND id='cmp_pg_legacy_unverified' AND confinement_class='unverified_vm' AND status='quarantined' AND policy_generation=2) THEN
    RAISE EXCEPTION 'preexisting unverified local_vm was not demoted on first application';
  END IF;
  IF EXISTS (SELECT 1 FROM resident_bindings WHERE tenant_id='tenant_pg_legacy_unverified' AND computer_id='cmp_pg_legacy_unverified')
    OR EXISTS (SELECT 1 FROM home_leases WHERE tenant_id='tenant_pg_legacy_unverified' AND computer_id='cmp_pg_legacy_unverified')
    OR EXISTS (SELECT 1 FROM operation_home_leases WHERE tenant_id='tenant_pg_legacy_unverified' AND computer_id='cmp_pg_legacy_unverified') THEN
    RAISE EXCEPTION 'preexisting unverified local_vm leases or resident binding survived first application';
  END IF;
  IF EXISTS (SELECT 1 FROM resident_enrollments WHERE id='ren_pg_legacy_unverified' AND revoked_at IS NULL)
    OR EXISTS (SELECT 1 FROM resident_identities WHERE certificate_id='cert_pg_legacy_unverified' AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'preexisting unverified local_vm resident credentials survived first application';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM computers WHERE tenant_id='tenant_pg_terminal' AND id='cmp_pg_deleted' AND confinement_class='unverified_vm' AND status='deleted' AND policy_generation=2)
    OR NOT EXISTS (SELECT 1 FROM computers WHERE tenant_id='tenant_pg_terminal' AND id='cmp_pg_deleting' AND confinement_class='unverified_vm' AND status='deleting' AND policy_generation=2) THEN
    RAISE EXCEPTION 'terminal local_vm status or generation changed incorrectly on first application';
  END IF;
  IF EXISTS (SELECT 1 FROM resident_bindings WHERE tenant_id='tenant_pg_terminal')
    OR EXISTS (SELECT 1 FROM home_leases WHERE tenant_id='tenant_pg_terminal')
    OR EXISTS (SELECT 1 FROM operation_home_leases WHERE tenant_id='tenant_pg_terminal') THEN
    RAISE EXCEPTION 'terminal local_vm leases or resident bindings survived first application';
  END IF;
  IF EXISTS (SELECT 1 FROM resident_enrollments WHERE tenant_id='tenant_pg_terminal' AND revoked_at IS NULL)
    OR EXISTS (SELECT 1 FROM resident_identities WHERE tenant_id='tenant_pg_terminal' AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'terminal local_vm resident credentials survived first application';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('cmp_pg_provisioning'::text,4::bigint),
      ('cmp_pg_stopped'::text,6::bigint),
      ('cmp_pg_quarantined'::text,8::bigint),
      ('cmp_pg_error'::text,10::bigint)
    ) AS expected(id, generation)
    LEFT JOIN computers c ON c.tenant_id='tenant_pg_status' AND c.id=expected.id
    WHERE c.id IS NULL OR c.confinement_class <> 'unverified_vm' OR c.status <> 'quarantined' OR c.policy_generation <> expected.generation
  ) THEN RAISE EXCEPTION 'not every nonterminal local_vm state was quarantined and generation-fenced'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='provider_assurance' AND relrowsecurity AND relforcerowsecurity) THEN RAISE EXCEPTION 'provider_assurance RLS is not forced'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='computers_local_vm_unverified_check') THEN RAISE EXCEPTION 'local_vm confinement check is absent'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='provider_assurance_computer_provider_fkey') THEN RAISE EXCEPTION 'provider assurance Computer/provider provenance is absent'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='provider_assurance_operation_computer_fkey') THEN RAISE EXCEPTION 'provider assurance operation/Computer provenance is absent'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='provider_assurance_attempt_operation_fkey') THEN RAISE EXCEPTION 'provider assurance attempt/operation provenance is absent'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='provider_bindings_computer_provider_fkey') THEN RAISE EXCEPTION 'provider binding Computer/provider provenance is absent'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='provider_bindings_operation_computer_fkey') THEN RAISE EXCEPTION 'provider binding operation/Computer provenance is absent'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='provider_bindings_attempt_operation_fkey') THEN RAISE EXCEPTION 'provider binding attempt/operation provenance is absent'; END IF;
  IF NOT EXISTS (SELECT 1 FROM provider_bindings WHERE tenant_id='tenant_pg_a' AND computer_id='cmp_pg_vm' AND operation_id='opn_pg_vm' AND attempt_id='pat_pg_vm') THEN
    RAISE EXCEPTION 'valid provider binding was not preserved';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE grantee='PUBLIC' AND table_name='provider_assurance') THEN RAISE EXCEPTION 'provider_assurance remains public'; END IF;
END $$;

INSERT INTO profiles (id,tenant_id,name,created_at) VALUES ('profile_shared','tenant_pg_b','Shared B',now()), ('profile_only_a','tenant_pg_a','Only A',now());
DO $$ BEGIN
  BEGIN
    INSERT INTO profile_revisions (id,profile_id,tenant_id,generation,digest,document_json,created_at)
    VALUES ('prv_cross','profile_only_a','tenant_pg_b',1,'sha256:' || repeat('b',64),'{}',now());
    RAISE EXCEPTION 'cross-tenant profile revision was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN
    UPDATE computers SET confinement_class='strict_vm' WHERE tenant_id='tenant_pg_a' AND id='cmp_pg_vm';
    RAISE EXCEPTION 'stock local_vm strict confinement was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

INSERT INTO computers (tenant_id,id,slug,provider,confinement_class,status,owner_principal_id,policy_generation,data_exfiltration_protection,created_at,updated_at)
VALUES ('tenant_pg_a','cmp_pg_other','pg-other','local_vm','unverified_vm','stopped','principal_pg_other',1,false,now(),now());
INSERT INTO operations (tenant_id,id,computer_id,kind,status,policy_generation,idempotency_key,request_json,fence,created_at,updated_at)
VALUES ('tenant_pg_a','opn_pg_other','cmp_pg_other','create','succeeded',1,'pg-create-other','{}',0,now(),now());
INSERT INTO operation_attempts (id,tenant_id,operation_id,attempt_number,provider_idempotency_key,status,fence,started_at,completed_at)
VALUES ('pat_pg_other','tenant_pg_a','opn_pg_other',1,'provider:opn_pg_other','succeeded',0,now(),now());
DO $$ BEGIN
  BEGIN
    INSERT INTO provider_assurance (tenant_id,computer_id,provider,confinement_class,evidence_json,operation_id,attempt_id,binding_fence,generation,verified_at)
    VALUES ('tenant_pg_a','cmp_pg_vm','local_vm','strict_vm','{}','opn_pg_vm','pat_pg_vm',0,1,now());
    RAISE EXCEPTION 'stock local_vm strict assurance was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO provider_assurance (tenant_id,computer_id,provider,confinement_class,evidence_json,operation_id,attempt_id,binding_fence,generation,verified_at)
    VALUES ('tenant_pg_a','cmp_pg_vm','local_vm','unverified_vm','{}','opn_pg_other','pat_pg_other',0,1,now());
    RAISE EXCEPTION 'cross-Computer provider assurance was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN
    INSERT INTO provider_assurance (tenant_id,computer_id,provider,confinement_class,evidence_json,operation_id,attempt_id,binding_fence,generation,verified_at)
    VALUES ('tenant_pg_a','cmp_pg_vm','local_vm','unverified_vm','{}','opn_pg_vm','pat_pg_other',0,1,now());
    RAISE EXCEPTION 'cross-operation provider attempt was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN
    INSERT INTO provider_bindings (tenant_id,computer_id,provider,resource_id,operation_id,attempt_id,state,fence,updated_at)
    VALUES ('tenant_pg_a','cmp_pg_other','local_machine','resource_binding_provider','opn_pg_other','pat_pg_other','active',0,now());
    RAISE EXCEPTION 'cross-provider binding was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN
    INSERT INTO provider_bindings (tenant_id,computer_id,provider,resource_id,operation_id,attempt_id,state,fence,updated_at)
    VALUES ('tenant_pg_a','cmp_pg_other','local_vm','resource_binding_computer','opn_pg_vm','pat_pg_vm','active',0,now());
    RAISE EXCEPTION 'cross-Computer provider binding was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN
    INSERT INTO provider_bindings (tenant_id,computer_id,provider,resource_id,operation_id,attempt_id,state,fence,updated_at)
    VALUES ('tenant_pg_a','cmp_pg_other','local_vm','resource_binding_attempt','opn_pg_other','pat_pg_vm','active',0,now());
    RAISE EXCEPTION 'cross-operation provider binding attempt was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;

INSERT INTO provider_assurance (tenant_id,computer_id,provider,confinement_class,evidence_json,operation_id,attempt_id,binding_fence,generation,verified_at)
VALUES ('tenant_pg_a','cmp_pg_vm','local_vm','unverified_vm','{}','opn_pg_vm','pat_pg_vm',0,1,now());
INSERT INTO computers (tenant_id,id,slug,provider,confinement_class,status,owner_principal_id,policy_generation,data_exfiltration_protection,created_at,updated_at)
VALUES ('tenant_pg_b','cmp_pg_b','pg-b','local_vm','unverified_vm','stopped','principal_pg_b',1,false,now(),now());
INSERT INTO operations (tenant_id,id,computer_id,kind,status,policy_generation,idempotency_key,request_json,fence,created_at,updated_at)
VALUES ('tenant_pg_b','opn_pg_b','cmp_pg_b','create','succeeded',1,'pg-create-b','{}',0,now(),now());
INSERT INTO operation_attempts (id,tenant_id,operation_id,attempt_number,provider_idempotency_key,status,fence,started_at,completed_at)
VALUES ('pat_pg_b','tenant_pg_b','opn_pg_b',1,'provider:opn_pg_b','succeeded',0,now(),now());
DO $$ BEGIN
  BEGIN
    UPDATE provider_assurance SET confinement_class='strict_vm' WHERE tenant_id='tenant_pg_a' AND computer_id='cmp_pg_vm';
    RAISE EXCEPTION 'stock local_vm strict assurance update was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

INSERT INTO computers (tenant_id,id,slug,provider,confinement_class,status,owner_principal_id,policy_generation,data_exfiltration_protection,created_at,updated_at)
VALUES ('tenant_pg_post','cmp_pg_post','pg-post','local_vm','unverified_vm','running','principal_pg_post',7,false,now(),now());
INSERT INTO operations (tenant_id,id,computer_id,kind,status,policy_generation,idempotency_key,request_json,fence,created_at,updated_at)
VALUES ('tenant_pg_post','opn_pg_post','cmp_pg_post','create','running',7,'pg-create-post','{"source":"post-migration"}',9,now(),now());
INSERT INTO operation_attempts (id,tenant_id,operation_id,attempt_number,provider_idempotency_key,status,fence,started_at,execution_owner_token,execution_owner_generation,execution_owner_expires_at)
VALUES ('pat_pg_post','tenant_pg_post','opn_pg_post',1,'provider:opn_pg_post','running',9,now(),'owner-post',4,now() + interval '1 hour');
INSERT INTO home_leases (tenant_id,computer_id,holder_id,fence,expires_at,updated_at)
VALUES ('tenant_pg_post','cmp_pg_post','holder_pg_post',9,now() + interval '1 hour',now());
INSERT INTO operation_home_leases (tenant_id,operation_id,computer_id,home_id,holder_id,fence,expires_at)
VALUES ('tenant_pg_post','opn_pg_post','cmp_pg_post','home:cmp_pg_post','holder_pg_post',9,now() + interval '1 hour');
INSERT INTO resident_bindings (tenant_id,computer_id,provider,provider_resource_id,instance_id,boot_id,generation,updated_at)
VALUES ('tenant_pg_post','cmp_pg_post','local_vm','resource_pg_post','instance_pg_post','boot_pg_post',4,now());
INSERT INTO resident_enrollments (id,tenant_id,computer_id,expected_provider,expected_instance_id,expected_boot_id,binding_generation,token_hash,expires_at,created_at)
VALUES ('ren_pg_post','tenant_pg_post','cmp_pg_post','local_vm','instance_pg_post','boot_pg_post',4,repeat('c',64),now() + interval '1 hour',now());
INSERT INTO resident_identities (certificate_id,tenant_id,computer_id,provider,instance_id,boot_id,generation,binding_generation,issued_at,expires_at)
VALUES ('cert_pg_post','tenant_pg_post','cmp_pg_post','local_vm','instance_pg_post','boot_pg_post',4,4,now(),now() + interval '1 hour');
INSERT INTO resident_nonces (tenant_id,computer_id,nonce,operation_id,attempt_id,sequence,expires_at,created_at)
VALUES ('tenant_pg_post','cmp_pg_post','nonce_pg_post','opn_pg_post','pat_pg_post',3,now() + interval '1 hour',now());
INSERT INTO provider_assurance (tenant_id,computer_id,provider,confinement_class,evidence_json,operation_id,attempt_id,binding_fence,generation,verified_at)
VALUES ('tenant_pg_post','cmp_pg_post','local_vm','unverified_vm','{"source":"post-migration","verified":true}','opn_pg_post','pat_pg_post',9,4,now());
INSERT INTO provider_bindings (tenant_id,computer_id,provider,resource_id,instance_id,boot_id,operation_id,attempt_id,state,fence,updated_at)
VALUES ('tenant_pg_post','cmp_pg_post','local_vm','resource_pg_post','instance_pg_post','boot_pg_post','opn_pg_post','pat_pg_post','active',9,now());
SQL

migrator_psql -X -q -d "$database" -v ON_ERROR_STOP=1 <<'SQL'
CREATE TEMP VIEW replay_authority_state AS
SELECT 'computers'::text AS relation, count(*) AS row_count, COALESCE(jsonb_agg(to_jsonb(t))::text, '[]') AS payload FROM computers t WHERE tenant_id='tenant_pg_post' AND id='cmp_pg_post'
UNION ALL SELECT 'operations', count(*), COALESCE(jsonb_agg(to_jsonb(t))::text, '[]') FROM operations t WHERE tenant_id='tenant_pg_post' AND id='opn_pg_post'
UNION ALL SELECT 'operation_attempts', count(*), COALESCE(jsonb_agg(to_jsonb(t))::text, '[]') FROM operation_attempts t WHERE tenant_id='tenant_pg_post' AND id='pat_pg_post'
UNION ALL SELECT 'home_leases', count(*), COALESCE(jsonb_agg(to_jsonb(t))::text, '[]') FROM home_leases t WHERE tenant_id='tenant_pg_post' AND computer_id='cmp_pg_post'
UNION ALL SELECT 'operation_home_leases', count(*), COALESCE(jsonb_agg(to_jsonb(t))::text, '[]') FROM operation_home_leases t WHERE tenant_id='tenant_pg_post' AND operation_id='opn_pg_post'
UNION ALL SELECT 'resident_bindings', count(*), COALESCE(jsonb_agg(to_jsonb(t))::text, '[]') FROM resident_bindings t WHERE tenant_id='tenant_pg_post' AND computer_id='cmp_pg_post'
UNION ALL SELECT 'resident_enrollments', count(*), COALESCE(jsonb_agg(to_jsonb(t))::text, '[]') FROM resident_enrollments t WHERE tenant_id='tenant_pg_post' AND id='ren_pg_post'
UNION ALL SELECT 'resident_identities', count(*), COALESCE(jsonb_agg(to_jsonb(t))::text, '[]') FROM resident_identities t WHERE tenant_id='tenant_pg_post' AND certificate_id='cert_pg_post'
UNION ALL SELECT 'resident_nonces', count(*), COALESCE(jsonb_agg(to_jsonb(t))::text, '[]') FROM resident_nonces t WHERE tenant_id='tenant_pg_post' AND nonce='nonce_pg_post'
UNION ALL SELECT 'provider_assurance', count(*), COALESCE(jsonb_agg(to_jsonb(t))::text, '[]') FROM provider_assurance t WHERE tenant_id='tenant_pg_post' AND computer_id='cmp_pg_post'
UNION ALL SELECT 'provider_bindings', count(*), COALESCE(jsonb_agg(to_jsonb(t))::text, '[]') FROM provider_bindings t WHERE tenant_id='tenant_pg_post' AND computer_id='cmp_pg_post';
CREATE TEMP TABLE replay_before AS TABLE replay_authority_state;
\i migrations/postgres/0002_provider_assurance.sql
\i migrations/postgres/0003_provider_binding_provenance.sql
CREATE TEMP TABLE replay_after AS TABLE replay_authority_state;
DO $$
BEGIN
  IF EXISTS (SELECT relation, row_count, payload FROM replay_before EXCEPT SELECT relation, row_count, payload FROM replay_after)
    OR EXISTS (SELECT relation, row_count, payload FROM replay_after EXCEPT SELECT relation, row_count, payload FROM replay_before) THEN
    RAISE EXCEPTION 'valid post-migration local_vm authority changed during replay';
  END IF;
END $$;
SQL
replay_state="$(psql -X -qAt -d "$database" -v ON_ERROR_STOP=1 -c "SELECT count(*)::text || ':' || max(version)::text FROM schema_migrations;")"
[[ "$replay_state" == "3:3" ]]
replay_authority_counts="$(psql -X -qAt -d "$database" -v ON_ERROR_STOP=1 -c "SELECT
  (SELECT count(*) FROM computers WHERE tenant_id='tenant_pg_post' AND id='cmp_pg_post')::text || ':' ||
  (SELECT count(*) FROM operations WHERE tenant_id='tenant_pg_post' AND id='opn_pg_post')::text || ':' ||
  (SELECT count(*) FROM operation_attempts WHERE tenant_id='tenant_pg_post' AND id='pat_pg_post')::text || ':' ||
  (SELECT count(*) FROM home_leases WHERE tenant_id='tenant_pg_post' AND computer_id='cmp_pg_post')::text || ':' ||
  (SELECT count(*) FROM operation_home_leases WHERE tenant_id='tenant_pg_post' AND operation_id='opn_pg_post')::text || ':' ||
  (SELECT count(*) FROM resident_bindings WHERE tenant_id='tenant_pg_post' AND computer_id='cmp_pg_post')::text || ':' ||
  (SELECT count(*) FROM resident_enrollments WHERE tenant_id='tenant_pg_post' AND id='ren_pg_post' AND revoked_at IS NULL)::text || ':' ||
  (SELECT count(*) FROM resident_identities WHERE tenant_id='tenant_pg_post' AND certificate_id='cert_pg_post' AND revoked_at IS NULL)::text || ':' ||
  (SELECT count(*) FROM resident_nonces WHERE tenant_id='tenant_pg_post' AND nonce='nonce_pg_post')::text || ':' ||
  (SELECT count(*) FROM provider_assurance WHERE tenant_id='tenant_pg_post' AND computer_id='cmp_pg_post')::text || ':' ||
  (SELECT count(*) FROM provider_bindings WHERE tenant_id='tenant_pg_post' AND computer_id='cmp_pg_post')::text;")"
[[ "$replay_authority_counts" == "1:1:1:1:1:1:1:1:1:1:1" ]]

migrator_psql -X -q -d "$database" -v ON_ERROR_STOP=1 -c "GRANT USAGE ON SCHEMA public TO $application_role; GRANT SELECT,INSERT,UPDATE,DELETE ON computers,provider_assurance TO $application_role; GRANT EXECUTE ON FUNCTION computers_current_tenant() TO $application_role;"

without_tenant="$(psql -X -qAt -d "$database" -v ON_ERROR_STOP=1 -c "SET ROLE $application_role; SELECT (SELECT count(*) FROM computers)::text || ':' || (SELECT count(*) FROM provider_assurance)::text;")"
[[ "$without_tenant" == "0:0" ]]
with_tenant="$(psql -X -qAt -d "$database" -v ON_ERROR_STOP=1 -c "SET ROLE $application_role; BEGIN; SET LOCAL computers.tenant_id='tenant_pg_a'; SELECT (SELECT count(*) FROM computers)::text || ':' || (SELECT count(*) FROM provider_assurance)::text; COMMIT;")"
[[ "$with_tenant" == "2:1" ]]
if psql -X -q -d "$database" -v ON_ERROR_STOP=1 -c "SET ROLE $application_role; BEGIN; SET LOCAL computers.tenant_id='tenant_pg_a'; INSERT INTO computers (tenant_id,id,slug,provider,confinement_class,status,owner_principal_id,policy_generation,data_exfiltration_protection,created_at,updated_at) VALUES ('tenant_pg_b','cmp_cross_rls','cross-rls','local_vm','unverified_vm','stopped','principal_cross',1,false,now(),now()); COMMIT;" >/dev/null 2>&1; then
  echo "cross-tenant app-role insert unexpectedly succeeded" >&2
  exit 1
fi
if psql -X -q -d "$database" -v ON_ERROR_STOP=1 -c "SET ROLE $application_role; BEGIN; SET LOCAL computers.tenant_id='tenant_pg_a'; INSERT INTO provider_assurance (tenant_id,computer_id,provider,confinement_class,evidence_json,operation_id,attempt_id,binding_fence,generation,verified_at) VALUES ('tenant_pg_b','cmp_pg_b','local_vm','unverified_vm','{}','opn_pg_b','pat_pg_b',0,1,now()); COMMIT;" >/dev/null 2>&1; then
  echo "cross-tenant provider-assurance insert unexpectedly succeeded" >&2
  exit 1
fi

psql -X -q -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $role_failure_database OWNER $rejected_migration_role;"
rejected_migrator_psql -X -q -d "$role_failure_database" -v ON_ERROR_STOP=1 -f migrations/postgres/0001_initial.sql >/dev/null
psql -X -q -d "$role_failure_database" -v ON_ERROR_STOP=1 -c "INSERT INTO computers (tenant_id,id,slug,provider,confinement_class,status,owner_principal_id,policy_generation,data_exfiltration_protection,created_at,updated_at) VALUES ('tenant_role_failure','cmp_role_failure','role-failure','local_vm','strict_vm','running','principal_role_failure',1,false,now(),now());"
if rejected_migrator_psql -X -q -d "$role_failure_database" -v ON_ERROR_STOP=1 -f migrations/postgres/0002_provider_assurance.sql >"$temp_directory/role-failure.out" 2>&1; then
  echo "NOBYPASSRLS migration role unexpectedly applied PostgreSQL 0002" >&2
  exit 1
fi
grep -F "provider-assurance migration requires a dedicated BYPASSRLS migration role" "$temp_directory/role-failure.out" >/dev/null
role_failure_state="$(psql -X -qAt -d "$role_failure_database" -v ON_ERROR_STOP=1 -c "SELECT
  (SELECT max(version)::text FROM schema_migrations) || ':' ||
  (SELECT relforcerowsecurity::text FROM pg_class WHERE oid='computers'::regclass) || ':' ||
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='operation_attempts' AND column_name='execution_owner_token')::text || ':' ||
  (to_regclass('provider_assurance') IS NOT NULL)::text || ':' ||
  EXISTS (SELECT 1 FROM computers WHERE id='cmp_role_failure' AND confinement_class='strict_vm' AND status='running' AND policy_generation=1)::text;")"
[[ "$role_failure_state" == "1:true:false:false:true" ]]

psql -X -q -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $rollback_database OWNER $migration_role;"
migrator_psql -X -q -d "$rollback_database" -v ON_ERROR_STOP=1 -f migrations/postgres/0001_initial.sql
migrator_psql -X -q -d "$rollback_database" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO computers (tenant_id,id,slug,provider,confinement_class,status,owner_principal_id,policy_generation,data_exfiltration_protection,created_at,updated_at)
VALUES ('tenant_rollback','cmp_rollback','rollback-vm','local_vm','strict_vm','running','principal_rollback',1,false,now(),now());
INSERT INTO home_leases (tenant_id,computer_id,holder_id,fence,expires_at,updated_at)
VALUES ('tenant_rollback','cmp_rollback','holder_rollback',1,now() + interval '1 hour',now());
INSERT INTO resident_bindings (tenant_id,computer_id,provider,provider_resource_id,instance_id,boot_id,generation,updated_at)
VALUES ('tenant_rollback','cmp_rollback','local_vm','resource_rollback','instance_rollback','boot_rollback',1,now());
INSERT INTO resident_enrollments (id,tenant_id,computer_id,expected_provider,expected_instance_id,expected_boot_id,binding_generation,token_hash,expires_at,created_at)
VALUES ('ren_rollback','tenant_rollback','cmp_rollback','local_vm','instance_rollback','boot_rollback',1,repeat('d',64),now() + interval '1 hour',now());
SQL
migrator_psql -X -q -d "$rollback_database" -v ON_ERROR_STOP=1 -c "CREATE UNIQUE INDEX operations_assurance_computer_key ON operations (id);"
if migrator_psql -X -q -d "$rollback_database" -v ON_ERROR_STOP=1 -f migrations/postgres/0002_provider_assurance.sql >/dev/null 2>&1; then
  echo "intentionally conflicting migration unexpectedly succeeded" >&2
  exit 1
fi
rollback_state="$(psql -X -qAt -d "$rollback_database" -v ON_ERROR_STOP=1 -c "SELECT max(version)::text || ':' || EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='operation_attempts' AND column_name='execution_owner_token')::text || ':' || (to_regclass('provider_assurance') IS NOT NULL)::text || ':' || EXISTS (SELECT 1 FROM computers WHERE tenant_id='tenant_rollback' AND id='cmp_rollback' AND confinement_class='strict_vm' AND status='running' AND policy_generation=1)::text || ':' || EXISTS (SELECT 1 FROM home_leases WHERE tenant_id='tenant_rollback' AND computer_id='cmp_rollback')::text || ':' || EXISTS (SELECT 1 FROM resident_bindings WHERE tenant_id='tenant_rollback' AND computer_id='cmp_rollback')::text || ':' || EXISTS (SELECT 1 FROM resident_enrollments WHERE tenant_id='tenant_rollback' AND id='ren_rollback')::text FROM schema_migrations;")"
[[ "$rollback_state" == "1:false:false:true:true:true:true" ]]

psql -X -q -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $rollback3_database OWNER $migration_role;"
migrator_psql -X -q -d "$rollback3_database" -v ON_ERROR_STOP=1 -f migrations/postgres/0001_initial.sql
migrator_psql -X -q -d "$rollback3_database" -v ON_ERROR_STOP=1 -f migrations/postgres/0002_provider_assurance.sql
migrator_psql -X -q -d "$rollback3_database" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO computers (tenant_id,id,slug,provider,confinement_class,status,owner_principal_id,policy_generation,data_exfiltration_protection,created_at,updated_at)
VALUES
  ('tenant_rollback3','cmp_rollback3_a','rollback3-a','local_machine','dedicated_machine','stopped','principal_rollback3_a',1,false,now(),now()),
  ('tenant_rollback3','cmp_rollback3_b','rollback3-b','local_machine','dedicated_machine','stopped','principal_rollback3_b',1,false,now(),now());
INSERT INTO operations (tenant_id,id,computer_id,kind,status,policy_generation,idempotency_key,request_json,fence,created_at,updated_at)
VALUES ('tenant_rollback3','opn_rollback3_b','cmp_rollback3_b','create','succeeded',1,'rollback3-b','{}',0,now(),now());
INSERT INTO operation_attempts (id,tenant_id,operation_id,attempt_number,provider_idempotency_key,status,fence,started_at,completed_at)
VALUES ('pat_rollback3_b','tenant_rollback3','opn_rollback3_b',1,'provider:rollback3-b','succeeded',0,now(),now());
INSERT INTO provider_bindings (tenant_id,computer_id,provider,resource_id,operation_id,attempt_id,state,fence,updated_at)
VALUES ('tenant_rollback3','cmp_rollback3_a','local_machine','resource_rollback3','opn_rollback3_b','pat_rollback3_b','active',0,now());
SQL
if migrator_psql -X -q -d "$rollback3_database" -v ON_ERROR_STOP=1 -f migrations/postgres/0003_provider_binding_provenance.sql >/dev/null 2>&1; then
  echo "invalid provider binding provenance migration unexpectedly succeeded" >&2
  exit 1
fi
rollback3_state="$(psql -X -qAt -d "$rollback3_database" -v ON_ERROR_STOP=1 -c "SELECT (SELECT max(version)::text FROM schema_migrations) || ':' || (SELECT count(*)::text FROM provider_bindings) || ':' || EXISTS (SELECT 1 FROM pg_constraint WHERE conname='provider_bindings_computer_provider_fkey')::text;")"
[[ "$rollback3_state" == "2:1:false" ]]

psql -X -q -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $writer_database OWNER $migration_role;"
migrator_psql -X -q -d "$writer_database" -v ON_ERROR_STOP=1 -f migrations/postgres/0001_initial.sql >/dev/null
migrator_psql -X -q -d "$writer_database" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO computers (tenant_id,id,slug,provider,confinement_class,status,owner_principal_id,policy_generation,data_exfiltration_protection,created_at,updated_at)
VALUES ('tenant_writer','cmp_writer_legacy','writer-legacy','local_vm','strict_vm','running','principal_writer_legacy',1,false,now(),now());
SQL
migrator_psql -X -q -d "$writer_database" -v ON_ERROR_STOP=1 -c "GRANT USAGE ON SCHEMA public TO $application_role; GRANT SELECT,INSERT ON computers TO $application_role; GRANT EXECUTE ON FUNCTION computers_current_tenant() TO $application_role;"

coproc WRITER_GATE {
  PGAPPNAME="${prefix}_writer_gate" psql -X -q -d "$writer_database" -v ON_ERROR_STOP=1 >"$temp_directory/writer-gate.out" 2>&1
}
writer_gate_pid="$WRITER_GATE_PID"
writer_gate_input_fd="${WRITER_GATE[1]}"
background_pids+=("$writer_gate_pid")
background_input_fds+=("$writer_gate_input_fd")
printf '%s\n' 'BEGIN;' 'LOCK TABLE operation_attempts IN ACCESS SHARE MODE;' >&"$writer_gate_input_fd"
wait_for_sql_true "$writer_database" "writer-proof gate lock" "SELECT count(*)=1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.datname=current_database() AND a.application_name='${prefix}_writer_gate' AND l.relation='operation_attempts'::regclass AND l.mode='AccessShareLock' AND l.granted;"
writer_gate_backend_pid="$(psql -X -qAt -d "$writer_database" -v ON_ERROR_STOP=1 -c "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND application_name='${prefix}_writer_gate';")"
[[ "$writer_gate_backend_pid" =~ ^[0-9]+$ ]]

PGAPPNAME="${prefix}_migration_writer_proof" PGOPTIONS="-c role=$migration_role" psql -X -q -d "$writer_database" -v ON_ERROR_STOP=1 -f migrations/postgres/0002_provider_assurance.sql >"$temp_directory/writer-migration.out" 2>&1 &
writer_migration_pid=$!
background_pids+=("$writer_migration_pid")
wait_for_sql_true "$writer_database" "writer-proof migrator to hold all serialization locks and wait on operation_attempts" "SELECT count(*)=1
FROM pg_stat_activity a
JOIN pg_locks pending ON pending.pid=a.pid
CROSS JOIN LATERAL unnest(pg_blocking_pids(a.pid)) AS blocked(pid)
JOIN pg_stat_activity blocker ON blocker.pid=blocked.pid
WHERE a.datname=current_database()
  AND a.application_name='${prefix}_migration_writer_proof'
  AND a.wait_event_type='Lock'
  AND pending.relation='operation_attempts'::regclass
  AND pending.mode='AccessExclusiveLock'
  AND NOT pending.granted
  AND blocker.pid=$writer_gate_backend_pid
  AND blocker.application_name='${prefix}_writer_gate'
  AND EXISTS (
    SELECT 1 FROM pg_locks gate_lock
    WHERE gate_lock.pid=blocker.pid
      AND gate_lock.relation='operation_attempts'::regclass
      AND gate_lock.mode='AccessShareLock'
      AND gate_lock.granted
  )
  AND EXISTS (
    SELECT 1 FROM pg_locks held
    WHERE held.pid=a.pid
      AND held.relation='schema_migrations'::regclass
      AND held.mode='ShareRowExclusiveLock'
      AND held.granted
  )
  AND (
    SELECT count(DISTINCT c.relname)
    FROM pg_locks held
    JOIN pg_class c ON c.oid=held.relation
    WHERE held.pid=a.pid
      AND held.granted
      AND held.mode='ShareRowExclusiveLock'
      AND c.relname IN ('schema_migrations','computers','operations','operation_attempts','provider_bindings','operation_home_leases','home_leases','resident_bindings','resident_enrollments','resident_identities','resident_nonces','profiles','profile_revisions')
  )=13;"
writer_migration_backend_pid="$(psql -X -qAt -d "$writer_database" -v ON_ERROR_STOP=1 -c "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND application_name='${prefix}_migration_writer_proof';")"
[[ "$writer_migration_backend_pid" =~ ^[0-9]+$ ]]
migration_lock_count="$(psql -X -qAt -d "$writer_database" -v ON_ERROR_STOP=1 -c "SELECT count(DISTINCT c.relname) FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid JOIN pg_class c ON c.oid=l.relation WHERE a.application_name='${prefix}_migration_writer_proof' AND l.granted AND l.mode='ShareRowExclusiveLock' AND c.relname IN ('schema_migrations','computers','operations','operation_attempts','provider_bindings','operation_home_leases','home_leases','resident_bindings','resident_enrollments','resident_identities','resident_nonces','profiles','profile_revisions');")"
[[ "$migration_lock_count" == "13" ]]

PGAPPNAME="${prefix}_application_writer" psql -X -q -d "$writer_database" -v ON_ERROR_STOP=1 >"$temp_directory/application-writer.out" 2>&1 <<SQL &
SET ROLE $application_role;
BEGIN;
SET LOCAL computers.tenant_id='tenant_writer';
INSERT INTO computers (tenant_id,id,slug,provider,confinement_class,status,owner_principal_id,policy_generation,data_exfiltration_protection,created_at,updated_at)
VALUES ('tenant_writer','cmp_writer_race','writer-race','local_vm','strict_vm','running','principal_writer_race',1,false,now(),now());
COMMIT;
SQL
application_writer_pid=$!
background_pids+=("$application_writer_pid")
wait_for_sql_true "$writer_database" "application writer to wait on computers behind the exact migrator" "SELECT count(*)=1
FROM pg_stat_activity waiter
JOIN pg_locks waiting_lock ON waiting_lock.pid=waiter.pid
CROSS JOIN LATERAL unnest(pg_blocking_pids(waiter.pid)) AS blocked(pid)
JOIN pg_stat_activity blocker ON blocker.pid=blocked.pid
WHERE waiter.datname=current_database()
  AND waiter.application_name='${prefix}_application_writer'
  AND waiter.wait_event_type='Lock'
  AND waiting_lock.relation='computers'::regclass
  AND waiting_lock.mode='RowExclusiveLock'
  AND NOT waiting_lock.granted
  AND blocker.pid=$writer_migration_backend_pid
  AND blocker.application_name='${prefix}_migration_writer_proof'
  AND EXISTS (
    SELECT 1 FROM pg_locks blocking_lock
    WHERE blocking_lock.pid=blocker.pid
      AND blocking_lock.relation='computers'::regclass
      AND blocking_lock.mode='ShareRowExclusiveLock'
      AND blocking_lock.granted
  );"
application_writer_backend_pid="$(psql -X -qAt -d "$writer_database" -v ON_ERROR_STOP=1 -c "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND application_name='${prefix}_application_writer';")"
[[ "$application_writer_backend_pid" =~ ^[0-9]+$ ]]
writer_wait_evidence="$(psql -X -qAt -d "$writer_database" -v ON_ERROR_STOP=1 -c "SELECT waiter.pid::text || ':' || blocker.pid::text || ':' || waiting_lock.relation::regclass::text || ':' || blocker.application_name
FROM pg_stat_activity waiter
JOIN pg_locks waiting_lock ON waiting_lock.pid=waiter.pid
CROSS JOIN LATERAL unnest(pg_blocking_pids(waiter.pid)) AS blocked(pid)
JOIN pg_stat_activity blocker ON blocker.pid=blocked.pid
WHERE waiter.pid=$application_writer_backend_pid
  AND waiting_lock.relation='computers'::regclass
  AND waiting_lock.mode='RowExclusiveLock'
  AND NOT waiting_lock.granted
  AND blocker.pid=$writer_migration_backend_pid
  AND EXISTS (
    SELECT 1 FROM pg_locks blocking_lock
    WHERE blocking_lock.pid=blocker.pid
      AND blocking_lock.relation=waiting_lock.relation
      AND blocking_lock.mode='ShareRowExclusiveLock'
      AND blocking_lock.granted
  );")"
[[ "$writer_wait_evidence" == "$application_writer_backend_pid:$writer_migration_backend_pid:computers:${prefix}_migration_writer_proof" ]]
application_writer_blocked=true

printf '%s\n' 'COMMIT;' '\q' >&"$writer_gate_input_fd"
eval "exec ${writer_gate_input_fd}>&-"
if ! wait "$writer_gate_pid"; then
  echo "writer-proof transaction gate failed" >&2
  sed -n '1,80p' "$temp_directory/writer-gate.out" >&2
  exit 1
fi
if ! wait "$writer_migration_pid"; then
  echo "PostgreSQL 0002 failed during concurrent application-writer proof" >&2
  sed -n '1,80p' "$temp_directory/writer-migration.out" >&2
  exit 1
fi
if wait "$application_writer_pid"; then
  echo "concurrent legacy application writer unexpectedly survived migration" >&2
  exit 1
fi
grep -F "computers_local_vm_unverified_check" "$temp_directory/application-writer.out" >/dev/null
writer_state="$(psql -X -qAt -d "$writer_database" -v ON_ERROR_STOP=1 -c "SELECT
  (SELECT count(*) FROM schema_migrations WHERE version=2)::text || ':' ||
  (SELECT count(*) FROM computers WHERE id='cmp_writer_legacy' AND confinement_class='unverified_vm' AND status='quarantined' AND policy_generation=2)::text || ':' ||
  (SELECT count(*) FROM computers WHERE id='cmp_writer_race')::text;")"
[[ "$writer_state" == "1:1:0" ]]

psql -X -q -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $concurrent_database OWNER $migration_role;"
migrator_psql -X -q -d "$concurrent_database" -v ON_ERROR_STOP=1 -f migrations/postgres/0001_initial.sql
migrator_psql -X -q -d "$concurrent_database" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO computers (tenant_id,id,slug,provider,confinement_class,status,owner_principal_id,policy_generation,data_exfiltration_protection,created_at,updated_at)
VALUES ('tenant_concurrent','cmp_concurrent','concurrent-vm','local_vm','unverified_vm','running','principal_concurrent',1,false,now(),now());
INSERT INTO operations (tenant_id,id,computer_id,kind,status,policy_generation,idempotency_key,request_json,fence,created_at,updated_at)
VALUES ('tenant_concurrent','opn_concurrent','cmp_concurrent','create','running',1,'concurrent-create','{}',0,now(),now());
INSERT INTO operation_attempts (id,tenant_id,operation_id,attempt_number,provider_idempotency_key,status,fence,started_at)
VALUES ('pat_concurrent','tenant_concurrent','opn_concurrent',1,'provider:concurrent','running',0,now());
INSERT INTO home_leases (tenant_id,computer_id,holder_id,fence,expires_at,updated_at)
VALUES ('tenant_concurrent','cmp_concurrent','holder_concurrent',1,now() + interval '1 hour',now());
INSERT INTO operation_home_leases (tenant_id,operation_id,computer_id,home_id,holder_id,fence,expires_at)
VALUES ('tenant_concurrent','opn_concurrent','cmp_concurrent','home:cmp_concurrent','holder_concurrent',1,now() + interval '1 hour');
INSERT INTO resident_bindings (tenant_id,computer_id,provider,provider_resource_id,instance_id,boot_id,generation,updated_at)
VALUES ('tenant_concurrent','cmp_concurrent','local_vm','resource_concurrent','instance_concurrent','boot_concurrent',1,now());
INSERT INTO resident_enrollments (id,tenant_id,computer_id,expected_provider,expected_instance_id,expected_boot_id,binding_generation,token_hash,expires_at,created_at)
VALUES ('ren_concurrent','tenant_concurrent','cmp_concurrent','local_vm','instance_concurrent','boot_concurrent',1,repeat('e',64),now() + interval '1 hour',now());
INSERT INTO resident_identities (certificate_id,tenant_id,computer_id,provider,instance_id,boot_id,generation,binding_generation,issued_at,expires_at)
VALUES ('cert_concurrent','tenant_concurrent','cmp_concurrent','local_vm','instance_concurrent','boot_concurrent',1,1,now(),now() + interval '1 hour');
SQL
coproc CONCURRENT_GATE {
  PGAPPNAME="${prefix}_concurrent_gate" psql -X -q -d "$concurrent_database" -v ON_ERROR_STOP=1 >"$temp_directory/concurrent-gate.out" 2>&1
}
concurrent_gate_pid="$CONCURRENT_GATE_PID"
concurrent_gate_input_fd="${CONCURRENT_GATE[1]}"
background_pids+=("$concurrent_gate_pid")
background_input_fds+=("$concurrent_gate_input_fd")
printf '%s\n' 'BEGIN;' 'LOCK TABLE operation_attempts IN ACCESS SHARE MODE;' >&"$concurrent_gate_input_fd"
wait_for_sql_true "$concurrent_database" "concurrent-migrator gate lock" "SELECT count(*)=1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.datname=current_database() AND a.application_name='${prefix}_concurrent_gate' AND l.relation='operation_attempts'::regclass AND l.mode='AccessShareLock' AND l.granted;"
concurrent_gate_backend_pid="$(psql -X -qAt -d "$concurrent_database" -v ON_ERROR_STOP=1 -c "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND application_name='${prefix}_concurrent_gate';")"
[[ "$concurrent_gate_backend_pid" =~ ^[0-9]+$ ]]

PGAPPNAME="${prefix}_concurrent_first" PGOPTIONS="-c role=$migration_role" psql -X -q -d "$concurrent_database" -v ON_ERROR_STOP=1 -f migrations/postgres/0002_provider_assurance.sql >"$temp_directory/concurrent-first.out" 2>&1 &
concurrent_first_pid=$!
background_pids+=("$concurrent_first_pid")
wait_for_sql_true "$concurrent_database" "first migrator to hold schema_migrations and wait at the transaction gate" "SELECT count(*)=1
FROM pg_stat_activity a
JOIN pg_locks pending ON pending.pid=a.pid
CROSS JOIN LATERAL unnest(pg_blocking_pids(a.pid)) AS blocked(pid)
JOIN pg_stat_activity blocker ON blocker.pid=blocked.pid
WHERE a.datname=current_database()
  AND a.application_name='${prefix}_concurrent_first'
  AND a.wait_event_type='Lock'
  AND pending.relation='operation_attempts'::regclass
  AND pending.mode='AccessExclusiveLock'
  AND NOT pending.granted
  AND blocker.pid=$concurrent_gate_backend_pid
  AND blocker.application_name='${prefix}_concurrent_gate'
  AND EXISTS (
    SELECT 1 FROM pg_locks gate_lock
    WHERE gate_lock.pid=blocker.pid
      AND gate_lock.relation='operation_attempts'::regclass
      AND gate_lock.mode='AccessShareLock'
      AND gate_lock.granted
  )
  AND EXISTS (
    SELECT 1 FROM pg_locks held
    WHERE held.pid=a.pid
      AND held.relation='schema_migrations'::regclass
      AND held.mode='ShareRowExclusiveLock'
      AND held.granted
  );"
concurrent_first_backend_pid="$(psql -X -qAt -d "$concurrent_database" -v ON_ERROR_STOP=1 -c "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND application_name='${prefix}_concurrent_first';")"
[[ "$concurrent_first_backend_pid" =~ ^[0-9]+$ ]]

PGAPPNAME="${prefix}_concurrent_second" PGOPTIONS="-c role=$migration_role" psql -X -q -d "$concurrent_database" -v ON_ERROR_STOP=1 -f migrations/postgres/0002_provider_assurance.sql >"$temp_directory/concurrent-second.out" 2>&1 &
concurrent_second_pid=$!
background_pids+=("$concurrent_second_pid")
wait_for_sql_true "$concurrent_database" "second migrator to wait on the exact schema_migrations lock held by the first" "SELECT count(*)=1
FROM pg_stat_activity waiter
JOIN pg_locks waiting_lock ON waiting_lock.pid=waiter.pid
CROSS JOIN LATERAL unnest(pg_blocking_pids(waiter.pid)) AS blocked(pid)
JOIN pg_stat_activity blocker ON blocker.pid=blocked.pid
WHERE waiter.datname=current_database()
  AND waiter.application_name='${prefix}_concurrent_second'
  AND waiter.wait_event_type='Lock'
  AND waiting_lock.relation='schema_migrations'::regclass
  AND waiting_lock.mode='ShareRowExclusiveLock'
  AND NOT waiting_lock.granted
  AND blocker.pid=$concurrent_first_backend_pid
  AND blocker.application_name='${prefix}_concurrent_first'
  AND EXISTS (
    SELECT 1 FROM pg_locks held
    WHERE held.pid=blocker.pid
      AND held.relation='schema_migrations'::regclass
      AND held.mode='ShareRowExclusiveLock'
      AND held.granted
  );"
concurrent_second_backend_pid="$(psql -X -qAt -d "$concurrent_database" -v ON_ERROR_STOP=1 -c "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND application_name='${prefix}_concurrent_second';")"
[[ "$concurrent_second_backend_pid" =~ ^[0-9]+$ ]]
concurrent_wait_evidence="$(psql -X -qAt -d "$concurrent_database" -v ON_ERROR_STOP=1 -c "SELECT waiter.pid::text || ':' || blocker.pid::text || ':' || waiting_lock.relation::regclass::text || ':' || waiting_lock.mode || ':' || blocker.application_name
FROM pg_stat_activity waiter
JOIN pg_locks waiting_lock ON waiting_lock.pid=waiter.pid
CROSS JOIN LATERAL unnest(pg_blocking_pids(waiter.pid)) AS blocked(pid)
JOIN pg_stat_activity blocker ON blocker.pid=blocked.pid
WHERE waiter.pid=$concurrent_second_backend_pid
  AND waiting_lock.relation='schema_migrations'::regclass
  AND waiting_lock.mode='ShareRowExclusiveLock'
  AND NOT waiting_lock.granted
  AND blocker.pid=$concurrent_first_backend_pid;")"
[[ "$concurrent_wait_evidence" == "$concurrent_second_backend_pid:$concurrent_first_backend_pid:schema_migrations:ShareRowExclusiveLock:${prefix}_concurrent_first" ]]

printf '%s\n' 'COMMIT;' '\q' >&"$concurrent_gate_input_fd"
eval "exec ${concurrent_gate_input_fd}>&-"
if ! wait "$concurrent_gate_pid"; then
  echo "concurrent-migrator transaction gate failed" >&2
  sed -n '1,80p' "$temp_directory/concurrent-gate.out" >&2
  exit 1
fi
if ! wait "$concurrent_first_pid"; then
  echo "first concurrent PostgreSQL 0002 application failed" >&2
  sed -n '1,80p' "$temp_directory/concurrent-first.out" >&2
  exit 1
fi
if ! wait "$concurrent_second_pid"; then
  echo "second concurrent PostgreSQL 0002 application failed" >&2
  sed -n '1,80p' "$temp_directory/concurrent-second.out" >&2
  exit 1
fi
concurrent_state="$(psql -X -qAt -d "$concurrent_database" -v ON_ERROR_STOP=1 -c "SELECT
  (SELECT count(*) FROM schema_migrations WHERE version=2)::text || ':' ||
  (SELECT count(*) FROM computers WHERE tenant_id='tenant_concurrent' AND id='cmp_concurrent' AND confinement_class='unverified_vm' AND status='quarantined' AND policy_generation=2)::text || ':' ||
  (SELECT count(*) FROM home_leases WHERE tenant_id='tenant_concurrent' AND computer_id='cmp_concurrent')::text || ':' ||
  (SELECT count(*) FROM operation_home_leases WHERE tenant_id='tenant_concurrent' AND operation_id='opn_concurrent')::text || ':' ||
  (SELECT count(*) FROM resident_bindings WHERE tenant_id='tenant_concurrent' AND computer_id='cmp_concurrent')::text || ':' ||
  (SELECT count(*) FROM resident_enrollments WHERE id='ren_concurrent' AND revoked_at IS NULL)::text || ':' ||
  (SELECT count(*) FROM resident_identities WHERE certificate_id='cert_concurrent' AND revoked_at IS NULL)::text;")"
[[ "$concurrent_state" == "1:1:0:0:0:0:0" ]]

cleanup
set -e
trap - EXIT INT TERM
residue="$(psql -X -qAt -d postgres -v ON_ERROR_STOP=1 -c "SELECT
  (SELECT count(*) FROM pg_database WHERE datname IN ('$database','$rollback_database','$rollback3_database','$concurrent_database','$role_failure_database','$writer_database'))::text || ':' ||
  (SELECT count(*) FROM pg_roles WHERE rolname IN ('$application_role','$rejected_migration_role','$migration_role'))::text || ':' ||
  (SELECT count(*) FROM pg_stat_activity WHERE datname IN ('$database','$rollback_database','$rollback3_database','$concurrent_database','$role_failure_database','$writer_database'))::text;")"
[[ "$residue" == "0:0:0" ]]

echo "postgres 16.13 migration integration passed; roles=$role_state; rejected-role rollback=$role_failure_state; ordered-locks=$migration_lock_count; application-writer=blocked:$application_writer_blocked,wait=$writer_wait_evidence,state:$writer_state; legacy provider-authority=$legacy_provider_authority_state; migrator concurrency=wait:$concurrent_wait_evidence,state:$concurrent_state; replay exact-value relations=11 counts=$replay_authority_counts; cleanup residue databases:roles:sessions=$residue"
