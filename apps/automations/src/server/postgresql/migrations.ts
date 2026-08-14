import { createHash } from "node:crypto";

export interface PostgreSqlExecutor {
  unsafe<T extends Record<string, unknown> = Record<string, unknown>>(query: string, parameters?: unknown[]): Promise<T[]>;
  begin<T>(callback: (transaction: PostgreSqlExecutor) => Promise<T>): Promise<T>;
}

export interface MigrationPlanEntry { id: string; checksum: string; applied: boolean }
export interface MigrationResult { dryRun: boolean; migrations: MigrationPlanEntry[] }
interface Migration { id: string; sql: string; checksum: string }

const SCHEMA_SQL = `
CREATE TABLE automations (
  id text PRIMARY KEY,
  spec_json jsonb NOT NULL CHECK (jsonb_typeof(spec_json) = 'object'),
  status text NOT NULL CHECK (status IN ('active','paused','archived')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE TABLE webhook_routes (
  id text PRIMARY KEY,
  automation_id text NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  path text NOT NULL UNIQUE CHECK (path LIKE '/%'),
  status text NOT NULL CHECK (status IN ('active','disabled','archived')),
  signature_json jsonb, mapping_json jsonb NOT NULL CHECK (jsonb_typeof(mapping_json) = 'object'),
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, metadata_json jsonb
);
CREATE TABLE automation_runs (
  id text PRIMARY KEY,
  automation_id text NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending','materialized','running','succeeded','failed','cancelled','dead')),
  trigger_json jsonb NOT NULL CHECK (jsonb_typeof(trigger_json) = 'object'),
  trigger_event_id text, idempotency_key text,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  started_at timestamptz, completed_at timestamptz, error text, metadata_json jsonb
);
CREATE UNIQUE INDEX automation_runs_idempotency_idx ON automation_runs(automation_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX automation_runs_automation_idx ON automation_runs(automation_id,created_at,id);
CREATE TABLE automation_actions (
  id text PRIMARY KEY,
  automation_run_id text NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
  step_id text NOT NULL, action_id text NOT NULL, idempotency_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','waiting_approval','claimed','retrying','succeeded','failed','dead','rejected','cancelled')),
  invocation_json jsonb NOT NULL CHECK (jsonb_typeof(invocation_json) = 'object'),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  available_at timestamptz NOT NULL, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  claimed_by text, claimed_at timestamptz, lease_expires_at timestamptz,
  claim_version bigint NOT NULL DEFAULT 0 CHECK (claim_version >= 0),
  approval_gate_json jsonb, result_json jsonb, error_json jsonb, dead_letter_json jsonb, metadata_json jsonb,
  UNIQUE (automation_run_id,step_id), UNIQUE (automation_run_id,idempotency_key)
);
CREATE INDEX automation_actions_run_status_idx ON automation_actions(automation_run_id,status);
CREATE INDEX automation_actions_available_idx ON automation_actions(status,available_at,created_at,id);
CREATE TABLE automation_action_dependencies (
  automation_run_id text NOT NULL,
  action_id text NOT NULL REFERENCES automation_actions(id) ON DELETE CASCADE,
  dependency_action_id text NOT NULL REFERENCES automation_actions(id) ON DELETE CASCADE,
  PRIMARY KEY(action_id,dependency_action_id),
  CHECK (action_id <> dependency_action_id)
);
CREATE INDEX automation_action_dependencies_run_idx ON automation_action_dependencies(automation_run_id);
CREATE TABLE automation_replay_requests (
  id text PRIMARY KEY, source_run_id text NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
  replay_identity text NOT NULL UNIQUE,
  requested_at timestamptz NOT NULL, requested_by text,
  mode text NOT NULL CHECK (mode IN ('failed-actions','dead-actions','entire-run')),
  reason text, metadata_json jsonb
);
CREATE INDEX automation_replay_source_idx ON automation_replay_requests(source_run_id,requested_at,id);
CREATE TABLE daemon_leases (
  id text PRIMARY KEY, pid integer NOT NULL CHECK (pid > 0), hostname text NOT NULL,
  heartbeat_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, metadata_json jsonb
);
CREATE INDEX daemon_leases_latest_idx ON daemon_leases(heartbeat_at DESC,id);
CREATE TABLE automation_concurrency_locks (
  concurrency_key text PRIMARY KEY,
  owner_run_id text NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
  fence_token bigint NOT NULL CHECK (fence_token > 0),
  acquired_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
CREATE INDEX automation_concurrency_locks_expiry_idx ON automation_concurrency_locks(expires_at);
CREATE INDEX webhook_routes_automation_idx ON webhook_routes(automation_id,created_at,id);
CREATE INDEX webhook_routes_status_idx ON webhook_routes(status,path);
`;

const SCALE_INDEXES_SQL = `
ALTER TABLE automations ADD COLUMN event_sources jsonb GENERATED ALWAYS AS (
  jsonb_path_query_array(spec_json, '$.triggers[*] ? (@.kind == "event").source')
) STORED;
CREATE INDEX automations_created_id_idx ON automations(created_at,id);
CREATE INDEX automations_active_event_sources_gin_idx ON automations USING gin(event_sources jsonb_path_ops) WHERE status='active';
CREATE INDEX automations_active_event_source_wildcard_idx ON automations(created_at,id)
  WHERE status='active'
    AND spec_json @? '$.triggers[*] ? (@.kind == "event" && !exists(@.source))'::jsonpath;
CREATE INDEX webhook_routes_created_id_idx ON webhook_routes(created_at,id);
CREATE INDEX automation_runs_created_id_idx ON automation_runs(created_at,id);
CREATE INDEX automation_actions_created_id_idx ON automation_actions(created_at,id);
CREATE INDEX automation_actions_dead_updated_id_idx ON automation_actions(updated_at,id) WHERE status='dead';
CREATE INDEX automation_actions_ready_order_idx ON automation_actions(available_at,created_at,id)
  WHERE status IN ('queued','retrying');
CREATE INDEX automation_actions_expired_claim_order_idx ON automation_actions(lease_expires_at,available_at,created_at,id)
  WHERE status='claimed' AND lease_expires_at IS NOT NULL;
CREATE INDEX daemon_leases_updated_id_idx ON daemon_leases(updated_at DESC,id);
CREATE INDEX automation_concurrency_locks_owner_run_idx ON automation_concurrency_locks(owner_run_id);
`;

const BOUNDED_CLAIM_CANDIDATES_SQL = `
ALTER TABLE automation_actions
  ADD COLUMN IF NOT EXISTS unmet_dependencies integer NOT NULL DEFAULT 0
  CHECK (unmet_dependencies >= 0);
CREATE TABLE automation_action_step_dependencies (
  automation_run_id text NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
  action_step_id text NOT NULL,
  dependency_step_id text NOT NULL,
  PRIMARY KEY(automation_run_id,action_step_id,dependency_step_id),
  CHECK (action_step_id <> dependency_step_id)
);
INSERT INTO automation_action_step_dependencies(
  automation_run_id,action_step_id,dependency_step_id
)
SELECT dependent.automation_run_id,dependent.step_id,prerequisite.step_id
FROM automation_action_dependencies legacy
JOIN automation_actions dependent ON dependent.id=legacy.action_id
JOIN automation_actions prerequisite ON prerequisite.id=legacy.dependency_action_id
WHERE dependent.automation_run_id=legacy.automation_run_id
  AND prerequisite.automation_run_id=legacy.automation_run_id
  AND dependent.id <> prerequisite.id
ON CONFLICT DO NOTHING;
INSERT INTO automation_action_step_dependencies(
  automation_run_id,action_step_id,dependency_step_id
)
SELECT action.automation_run_id,action.step_id,dependency.value
FROM automation_actions action
JOIN automation_runs run ON run.id=action.automation_run_id
JOIN automations automation ON automation.id=run.automation_id
CROSS JOIN LATERAL jsonb_array_elements(automation.spec_json->'actions') step
CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(step->'dependsOn','[]'::jsonb)) dependency(value)
WHERE step->>'id'=action.step_id
  AND NOT EXISTS (
    SELECT 1 FROM automation_action_dependencies legacy
    WHERE legacy.automation_run_id=action.automation_run_id
      AND legacy.action_id=action.id
  )
ON CONFLICT DO NOTHING;
UPDATE automation_actions action
SET unmet_dependencies = (
  SELECT count(*)
  FROM automation_action_step_dependencies dependency
  LEFT JOIN automation_actions required
    ON required.automation_run_id=dependency.automation_run_id
   AND required.step_id=dependency.dependency_step_id
  WHERE dependency.automation_run_id=action.automation_run_id
    AND dependency.action_step_id=action.step_id
    AND (required.id IS NULL OR required.status <> 'succeeded')
);
DROP INDEX automation_actions_ready_order_idx;
DROP INDEX automation_actions_expired_claim_order_idx;
CREATE INDEX automation_actions_ready_order_idx
  ON automation_actions(available_at,available_at,created_at,id,automation_run_id,step_id)
  WHERE status IN ('queued','retrying') AND unmet_dependencies=0;
CREATE INDEX automation_actions_expired_claim_order_idx
  ON automation_actions(lease_expires_at,available_at,created_at,id,automation_run_id,step_id)
  WHERE status='claimed' AND lease_expires_at IS NOT NULL AND unmet_dependencies=0;
CREATE INDEX automation_action_step_dependencies_lookup_idx
  ON automation_action_step_dependencies(automation_run_id,action_step_id,dependency_step_id);
`;

const migrations: Migration[] = [
  { id: "0001_server_schema", sql: SCHEMA_SQL, checksum: checksum(SCHEMA_SQL) },
  { id: "0002_scale_indexes", sql: SCALE_INDEXES_SQL, checksum: checksum(SCALE_INDEXES_SQL) },
  { id: "0003_bounded_claim_candidates", sql: BOUNDED_CLAIM_CANDIDATES_SQL, checksum: checksum(BOUNDED_CLAIM_CANDIDATES_SQL) },
];
const LEDGER = "hasna_automations_schema_migrations";
const LOCK_KEY = 7_104_510_021;

export async function migratePostgreSql(sql: PostgreSqlExecutor, options: { dryRun?: boolean } = {}): Promise<MigrationResult> {
  if (options.dryRun) {
    const exists = await sql.unsafe<{ exists: string | null }>("SELECT to_regclass('public.hasna_automations_schema_migrations')::text AS exists");
    const applied = exists[0]?.exists ? await readLedger(sql) : [];
    return { dryRun: true, migrations: validateAndPlan(applied) };
  }
  return sql.begin(async (transaction) => {
    await transaction.unsafe("SELECT pg_advisory_xact_lock($1::bigint)", [LOCK_KEY]);
    await transaction.unsafe(`CREATE TABLE IF NOT EXISTS ${LEDGER} (
      id text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const plan = validateAndPlan(await readLedger(transaction));
    for (const item of plan) {
      if (item.applied) continue;
      const migration = migrations.find((candidate) => candidate.id === item.id)!;
      await transaction.unsafe(migration.sql);
      await transaction.unsafe(`INSERT INTO ${LEDGER} (id,checksum) VALUES ($1,$2)`, [migration.id, migration.checksum]);
    }
    return { dryRun: false, migrations: plan };
  });
}

async function readLedger(sql: PostgreSqlExecutor): Promise<Array<{ id: string; checksum: string }>> {
  return sql.unsafe(`SELECT id,checksum FROM ${LEDGER} ORDER BY id`);
}
function validateAndPlan(applied: Array<{ id: string; checksum: string }>): MigrationPlanEntry[] {
  const known = new Map(migrations.map((migration) => [migration.id, migration]));
  for (const row of applied) {
    const migration = known.get(row.id);
    if (!migration) throw new Error(`unknown PostgreSQL migration in ledger: ${row.id}`);
    if (migration.checksum !== row.checksum) throw new Error(`PostgreSQL migration checksum mismatch: ${row.id}`);
  }
  const appliedIds = new Set(applied.map((row) => row.id));
  return migrations.map((migration) => ({ id: migration.id, checksum: migration.checksum, applied: appliedIds.has(migration.id) }));
}
function checksum(sql: string): string { return createHash("sha256").update(sql).digest("hex"); }
