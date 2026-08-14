-- @generated mirror of POSTGRES_STORAGE_MIGRATIONS["0009_tenant_backfill"] — DO NOT EDIT.
-- Source of truth: src/lib/storage/postgres-schema.ts
-- Runner: loops-serve migrate  (checksum: sha256:7bfd222e503736ec0bc2811f8a31d3e57820a0fa1106795e09fd26a5cf966f2c)

DO $tenant_backfill$
DECLARE
  target_table TEXT;
  id_column TEXT;
  missing_count BIGINT;
  mapping_count BIGINT;
BEGIN
  FOR target_table, id_column IN
    SELECT * FROM (VALUES
      ('loops', 'id'), ('loop_runs', 'id'), ('daemon_lease', 'id'),
      ('workflow_specs', 'id'), ('workflow_runs', 'id'), ('workflow_invocations', 'id'),
      ('workflow_work_items', 'id'), ('workflow_step_runs', 'id'), ('workflow_events', 'id'),
      ('goals', 'id'), ('goal_plan_nodes', 'id'), ('goal_runs', 'id'),
      ('runner_machines', 'id'), ('runner_leases', 'id'), ('audit_events', 'id'),
      ('run_receipts', 'run_id')
    ) AS targets(table_name, row_id_column)
  LOOP
    EXECUTE format(
      'UPDATE %I target SET tenant_id = assignment.tenant_id FROM tenant_row_assignments assignment WHERE assignment.table_name = $1 AND assignment.row_id = target.%I',
      target_table, id_column
    ) USING target_table;
    EXECUTE format('SELECT count(*) FROM %I WHERE tenant_id IS NULL', target_table) INTO missing_count;
    IF missing_count > 0 THEN
      RAISE EXCEPTION 'tenant backfill incomplete for %: % rows have no explicit assignment', target_table, missing_count;
    END IF;
    EXECUTE format('SELECT count(*) FROM tenant_row_assignments WHERE table_name = $1') INTO mapping_count USING target_table;
    EXECUTE format('SELECT count(*) FROM %I', target_table) INTO missing_count;
    IF mapping_count <> missing_count THEN
      RAISE EXCEPTION 'tenant assignment cardinality mismatch for %: mappings %, rows %', target_table, mapping_count, missing_count;
    END IF;
  END LOOP;

  UPDATE api_keys key
     SET tenant_id = binding.tenant_id,
         principal_id = binding.principal_id,
         token_kind = binding.token_kind
    FROM api_key_tenant_bindings binding
   WHERE binding.kid = key.kid;
  SELECT count(*) INTO missing_count
    FROM api_keys
   WHERE tenant_id IS NULL OR principal_id IS NULL OR token_kind IS NULL
      OR agent IS DISTINCT FROM principal_id;
  IF missing_count > 0 THEN
    RAISE EXCEPTION 'api key tenant backfill incomplete: % keys have no exact principal binding', missing_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM loop_runs child JOIN loops parent ON parent.id = child.loop_id WHERE child.tenant_id <> parent.tenant_id
    UNION ALL SELECT 1 FROM workflow_runs child JOIN workflow_specs parent ON parent.id = child.workflow_id WHERE child.tenant_id <> parent.tenant_id
    UNION ALL SELECT 1 FROM workflow_work_items child JOIN workflow_invocations parent ON parent.id = child.invocation_id WHERE child.tenant_id <> parent.tenant_id
    UNION ALL SELECT 1 FROM workflow_step_runs child JOIN workflow_runs parent ON parent.id = child.workflow_run_id WHERE child.tenant_id <> parent.tenant_id
    UNION ALL SELECT 1 FROM workflow_events child JOIN workflow_runs parent ON parent.id = child.workflow_run_id WHERE child.tenant_id <> parent.tenant_id
    UNION ALL SELECT 1 FROM goal_plan_nodes child JOIN goals parent ON parent.id = child.goal_id WHERE child.tenant_id <> parent.tenant_id
    UNION ALL SELECT 1 FROM goal_runs child JOIN goals parent ON parent.id = child.goal_id WHERE child.tenant_id <> parent.tenant_id
    UNION ALL SELECT 1 FROM runner_leases child JOIN runner_machines parent ON parent.id = child.runner_id WHERE child.tenant_id <> parent.tenant_id
  ) THEN
    RAISE EXCEPTION 'tenant backfill contains cross-tenant parent/child relationships';
  END IF;
END
$tenant_backfill$;
