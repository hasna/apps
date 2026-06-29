export const POSTGRES_PLAN_VERSION = 5;
export const POSTGRES_SCHEMA_VERSION = "5";
export const DEFAULT_POSTGRES_SCHEMA = "uptime";
export const DEFAULT_WORKSPACE_SETTING = "app.workspace_id";

const IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]*$/;

export interface PostgresMigrationPlanOptions {
  schemaName?: string;
  databaseUrl?: string;
  workspaceSetting?: string;
}

export interface PostgresMigrationPlan {
  kind: "open-uptime.postgres-migration-plan";
  version: number;
  status: "blocked";
  canApply: false;
  schemaName: string;
  schemaVersion: string;
  database: {
    configured: boolean;
    redactedUrl: string | null;
    validPostgresUrl: boolean;
    tlsRequired: boolean;
  };
  workspaceSetting: string;
  requiredTables: string[];
  requiredPolicies: string[];
  requiredIndexes: string[];
  migrationStatements: string[];
  rlsStatements: string[];
  safetyChecks: Array<{ name: string; ok: boolean; detail: string }>;
  blockers: string[];
  nextActions: string[];
}

const REQUIRED_TABLES = [
  "schema_migrations",
  "monitors",
  "check_results",
  "incidents",
  "check_jobs",
  "probe_identities",
  "probe_submissions",
  "report_schedules",
  "report_runs",
  "report_delivery_attempts",
  "report_artifacts",
  "audit_events",
  "sync_tombstones",
] as const;

const RLS_TABLES = REQUIRED_TABLES.filter((table) => table !== "schema_migrations");
const REQUIRED_INDEXES = [
  "monitors_workspace_status_idx",
  "monitors_workspace_name_active_idx",
  "check_results_workspace_monitor_time_idx",
  "check_jobs_workspace_status_due_idx",
  "report_schedules_due_idx",
  "report_runs_workspace_status_time_idx",
  "report_delivery_attempts_run_idx",
  "report_delivery_attempts_due_idx",
  "report_delivery_attempts_idempotency_idx",
  "report_artifacts_run_idx",
  "audit_events_workspace_time_idx",
] as const;

export function buildPostgresMigrationPlan(options: PostgresMigrationPlanOptions = {}): PostgresMigrationPlan {
  const schemaName = normalizeIdentifier(options.schemaName ?? DEFAULT_POSTGRES_SCHEMA, "Postgres schema name");
  const workspaceSetting = normalizeSetting(options.workspaceSetting ?? DEFAULT_WORKSPACE_SETTING);
  const databaseUrl = options.databaseUrl ?? process.env.HASNA_UPTIME_DATABASE_URL;
  const database = databaseUrl ? parsePostgresUrl(databaseUrl) : null;
  const migrationStatements = buildMigrationStatements(schemaName);
  const rlsStatements = buildRlsStatements(schemaName, workspaceSetting);
  const requiredPolicies = expectedRlsPolicies();
  const requiredIndexes = [...REQUIRED_INDEXES];
  const safetyChecks = [
    {
      name: "postgres-url",
      ok: Boolean(database?.validPostgresUrl),
      detail: database ? database.redactedUrl : "<unset>",
    },
    {
      name: "postgres-tls",
      ok: Boolean(database?.validPostgresUrl && database.tlsRequired),
      detail: database ? (database.tlsRequired ? "required" : "missing sslmode=require or ssl=true") : "<unset>",
    },
    {
      name: "workspace-scope-setting",
      ok: workspaceSetting.length > 0,
      detail: workspaceSetting,
    },
    {
      name: "tombstone-table",
      ok: migrationStatements.some((statement) => statement.includes("CREATE TABLE IF NOT EXISTS") && statement.includes("sync_tombstones")),
      detail: "sync_tombstones",
    },
    {
      name: "rls-policies",
      ok: rlsStatements.length === RLS_TABLES.length * 3 && rlsStatements.every((statement) => statement.includes("ENABLE ROW LEVEL SECURITY") || statement.includes("FORCE ROW LEVEL SECURITY") || statement.includes("IF NOT EXISTS")),
      detail: `${rlsStatements.length} statements`,
    },
    {
      name: "rls-force",
      ok: RLS_TABLES.every((tableName) => rlsStatements.some((statement) => statement.includes(`."${tableName}" FORCE ROW LEVEL SECURITY`))),
      detail: `${RLS_TABLES.length} tables`,
    },
    {
      name: "index-verification-targets",
      ok: REQUIRED_INDEXES.length > 0,
      detail: `${REQUIRED_INDEXES.length} indexes`,
    },
    {
      name: "async-runtime-adapter",
      ok: false,
      detail: "not wired to UptimeService yet",
    },
  ];
  const blockers = safetyChecks.filter((check) => !check.ok).map((check) => `${check.name}: ${check.detail}`);
  return {
    kind: "open-uptime.postgres-migration-plan",
    version: POSTGRES_PLAN_VERSION,
    status: "blocked",
    canApply: false,
    schemaName,
    schemaVersion: POSTGRES_SCHEMA_VERSION,
    database: {
      configured: Boolean(databaseUrl),
      redactedUrl: database?.redactedUrl ?? null,
      validPostgresUrl: database?.validPostgresUrl ?? false,
      tlsRequired: database?.tlsRequired ?? false,
    },
    workspaceSetting,
    requiredTables: [...REQUIRED_TABLES],
    requiredPolicies,
    requiredIndexes,
    migrationStatements,
    rlsStatements,
    safetyChecks,
    blockers,
    nextActions: [
      "Review this SQL against the approved application Postgres/RDS instance before any apply.",
      "Implement the async Postgres store before setting HASNA_UPTIME_DATABASE_URL on hosted ECS tasks.",
      "Run migration dry-runs that report counts, schema versions, and conflicts only; do not print row data or secrets.",
      "Keep hosted workers at desired count 0 until Postgres CRUD, check_jobs leases, and channel refs pass preflight.",
    ],
  };
}

export function renderPostgresMigrationPlan(plan: PostgresMigrationPlan): string {
  return [
    `Open Uptime Postgres migration plan (${plan.schemaName})`,
    `status: ${plan.status}`,
    `can apply: ${plan.canApply}`,
    `database: ${plan.database.redactedUrl ?? "<unset>"}`,
    `database TLS: ${plan.database.tlsRequired ? "required" : "missing"}`,
    `schema version: ${plan.schemaVersion}`,
    `workspace setting: ${plan.workspaceSetting}`,
    `tables: ${plan.requiredTables.join(", ")}`,
    `policies: ${plan.requiredPolicies.join(", ")}`,
    `indexes: ${plan.requiredIndexes.join(", ")}`,
    `migration statements: ${plan.migrationStatements.length}`,
    `rls statements: ${plan.rlsStatements.length}`,
    `blockers: ${plan.blockers.length}`,
    ...plan.blockers.map((blocker) => `- ${blocker}`),
  ].join("\n");
}

export function redactPostgresUrl(value: string): string {
  return parsePostgresUrl(value).redactedUrl;
}

function parsePostgresUrl(value: string): { redactedUrl: string; validPostgresUrl: boolean; tlsRequired: boolean } {
  try {
    const url = new URL(value);
    const validPostgresUrl = url.protocol === "postgres:" || url.protocol === "postgresql:";
    const tlsRequired = url.searchParams.get("sslmode") === "require" || url.searchParams.get("sslmode") === "verify-full" || url.searchParams.get("ssl") === "true";
    if (url.username) url.username = "user";
    if (url.password) url.password = "redacted";
    url.search = "";
    url.hash = "";
    return { redactedUrl: url.toString(), validPostgresUrl, tlsRequired };
  } catch {
    return { redactedUrl: "<invalid-url>", validPostgresUrl: false, tlsRequired: false };
  }
}

function normalizeIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`${label} must match ${IDENTIFIER_PATTERN.source}`);
  }
  return normalized;
}

function normalizeSetting(value: string): string {
  const normalized = value.trim();
  if (!/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)+$/.test(normalized)) {
    throw new Error("workspace setting must be a dotted lowercase setting such as app.workspace_id");
  }
  return normalized;
}

function q(schemaName: string, tableName: string): string {
  return `"${schemaName}"."${tableName}"`;
}

function buildMigrationStatements(schemaName: string): string[] {
  return [
    `CREATE SCHEMA IF NOT EXISTS "${schemaName}";`,
    `CREATE TABLE IF NOT EXISTS ${q(schemaName, "schema_migrations")} (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);`,
    `INSERT INTO ${q(schemaName, "schema_migrations")} (key, value, updated_at)
VALUES ('schema_version', '${POSTGRES_SCHEMA_VERSION}', now())
ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`,
    `CREATE TABLE IF NOT EXISTS ${q(schemaName, "monitors")} (
  workspace_id text NOT NULL,
  id text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('http', 'tcp', 'browser_page')),
  url text,
  host text,
  port integer,
  method text NOT NULL DEFAULT 'GET',
  expected_status integer,
  interval_seconds integer NOT NULL DEFAULT 60,
  timeout_ms integer NOT NULL DEFAULT 5000,
  retry_count integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'unknown',
  last_checked_at timestamptz,
  version bigint NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  actor text,
  origin text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);`,
    `CREATE TABLE IF NOT EXISTS ${q(schemaName, "check_results")} (
  workspace_id text NOT NULL,
  id text NOT NULL,
  monitor_id text NOT NULL,
  job_id text,
  probe_id text,
  monitor_version bigint NOT NULL,
  schedule_slot timestamptz,
  probe_class text CHECK (probe_class IN ('public', 'private')),
  probe_location text,
  probe_policy_hash text,
  checked_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('up', 'down')),
  latency_ms double precision,
  status_code integer,
  error text,
  attempt_count integer NOT NULL DEFAULT 1,
  evidence_json jsonb,
  actor text,
  origin text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, monitor_id) REFERENCES ${q(schemaName, "monitors")} (workspace_id, id)
);`,
    `CREATE TABLE IF NOT EXISTS ${q(schemaName, "incidents")} (
  workspace_id text NOT NULL,
  id text NOT NULL,
  monitor_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'acknowledged', 'silenced', 'maintenance', 'resolved', 'closed')),
  opened_at timestamptz NOT NULL,
  closed_at timestamptz,
  last_failure_at timestamptz NOT NULL,
  failure_count integer NOT NULL DEFAULT 1,
  recovery_check_id text,
  reason text,
  version bigint NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  actor text,
  origin text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, monitor_id) REFERENCES ${q(schemaName, "monitors")} (workspace_id, id)
);`,
    `CREATE TABLE IF NOT EXISTS ${q(schemaName, "check_jobs")} (
  workspace_id text NOT NULL,
  id text NOT NULL,
  monitor_id text NOT NULL,
  monitor_version bigint NOT NULL,
  monitor_snapshot jsonb NOT NULL,
  schedule_slot timestamptz NOT NULL,
  probe_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  probe_policy_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'claimed', 'submitted', 'expired', 'cancelled')),
  claimed_by_probe_id text,
  fencing_token text,
  due_at timestamptz NOT NULL,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  submitted_result_id text,
  deploy_generation bigint NOT NULL DEFAULT 0,
  version bigint NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  actor text,
  origin text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, monitor_id, monitor_version, schedule_slot, probe_policy_hash),
  FOREIGN KEY (workspace_id, monitor_id) REFERENCES ${q(schemaName, "monitors")} (workspace_id, id)
);`,
    `CREATE TABLE IF NOT EXISTS ${q(schemaName, "probe_identities")} (
  workspace_id text NOT NULL,
  id text NOT NULL,
  name text NOT NULL,
  probe_class text NOT NULL CHECK (probe_class IN ('public', 'private')),
  probe_location text NOT NULL DEFAULT 'default',
  machine_id text,
  public_key_pem text NOT NULL,
  public_key_fingerprint text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz,
  version bigint NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  actor text,
  origin text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, name),
  UNIQUE (workspace_id, public_key_fingerprint)
);`,
    `CREATE TABLE IF NOT EXISTS ${q(schemaName, "probe_submissions")} (
  workspace_id text NOT NULL,
  id text NOT NULL,
  probe_id text NOT NULL,
  job_id text NOT NULL,
  monitor_id text NOT NULL,
  check_result_id text NOT NULL,
  nonce text NOT NULL,
  monitor_revision bigint NOT NULL,
  schedule_slot timestamptz NOT NULL,
  probe_class text NOT NULL CHECK (probe_class IN ('public', 'private')),
  probe_location text NOT NULL,
  probe_policy_hash text NOT NULL,
  payload_hash text NOT NULL DEFAULT '',
  checked_at timestamptz NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  actor text,
  origin text,
  idempotency_key text,
  deleted_at timestamptz,
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, probe_id, nonce),
  UNIQUE (workspace_id, job_id)
);`,
    `CREATE TABLE IF NOT EXISTS ${q(schemaName, "report_schedules")} (
  workspace_id text NOT NULL,
  id text NOT NULL,
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  interval_seconds integer NOT NULL,
  next_run_at timestamptz NOT NULL,
  last_run_at timestamptz,
  subject text,
  channels_json jsonb NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  actor text,
  origin text,
  idempotency_key text,
  claimed_by_worker_id text,
  fencing_token text,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, name)
);`,
    `CREATE TABLE IF NOT EXISTS ${q(schemaName, "report_runs")} (
  workspace_id text NOT NULL,
  id text NOT NULL,
  schedule_id text,
  status text NOT NULL CHECK (status IN ('success', 'failed')),
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  deliveries_json jsonb NOT NULL,
  error text,
  report_json jsonb,
  artifact_ref text,
  actor text,
  origin text,
  idempotency_key text,
  deleted_at timestamptz,
  PRIMARY KEY (workspace_id, id)
);`,
    `CREATE TABLE IF NOT EXISTS ${q(schemaName, "report_delivery_attempts")} (
  workspace_id text NOT NULL,
  id text NOT NULL,
  report_run_id text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email', 'sms', 'logs')),
  channel_ref_id text NOT NULL,
  provider text NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  status text NOT NULL CHECK (status IN ('pending', 'sending', 'succeeded', 'failed', 'retry_exhausted')),
  idempotency_key text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  started_at timestamptz,
  finished_at timestamptz,
  next_retry_at timestamptz,
  response_status integer,
  provider_message_id text,
  error text,
  retry_after_seconds integer,
  request_hash text,
  response_hash text,
  claimed_by_worker_id text,
  fencing_token text,
  lease_expires_at timestamptz,
  version bigint NOT NULL DEFAULT 1,
  actor text,
  origin text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, report_run_id, channel, channel_ref_id, attempt_number),
  FOREIGN KEY (workspace_id, report_run_id) REFERENCES ${q(schemaName, "report_runs")} (workspace_id, id)
);`,
    `CREATE TABLE IF NOT EXISTS ${q(schemaName, "report_artifacts")} (
  workspace_id text NOT NULL,
  id text NOT NULL,
  report_run_id text NOT NULL,
  artifact_type text NOT NULL CHECK (artifact_type IN ('json', 'html', 'pdf', 'summary')),
  storage_ref text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  redacted boolean NOT NULL DEFAULT true,
  retention_class text NOT NULL DEFAULT 'standard' CHECK (retention_class IN ('standard', 'compliance', 'legal_hold')),
  kms_key_ref text,
  actor text,
  origin text,
  idempotency_key text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, report_run_id, artifact_type, sha256),
  FOREIGN KEY (workspace_id, report_run_id) REFERENCES ${q(schemaName, "report_runs")} (workspace_id, id)
);`,
    `CREATE TABLE IF NOT EXISTS ${q(schemaName, "audit_events")} (
  workspace_id text NOT NULL,
  id text NOT NULL,
  action text NOT NULL,
  resource_type text,
  resource_id text,
  message text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor text,
  origin text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (workspace_id, id)
);`,
    `CREATE TABLE IF NOT EXISTS ${q(schemaName, "sync_tombstones")} (
  workspace_id text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  deleted_at timestamptz NOT NULL,
  version bigint NOT NULL,
  actor text,
  origin text,
  idempotency_key text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (workspace_id, resource_type, resource_id)
);`,
    ...buildSchemaUpgradeStatements(schemaName),
    `CREATE INDEX IF NOT EXISTS monitors_workspace_status_idx ON ${q(schemaName, "monitors")} (workspace_id, status, enabled) WHERE deleted_at IS NULL;`,
    `CREATE UNIQUE INDEX IF NOT EXISTS monitors_workspace_name_active_idx ON ${q(schemaName, "monitors")} (workspace_id, name) WHERE deleted_at IS NULL;`,
    `CREATE INDEX IF NOT EXISTS check_results_workspace_monitor_time_idx ON ${q(schemaName, "check_results")} (workspace_id, monitor_id, checked_at DESC) WHERE deleted_at IS NULL;`,
    `CREATE INDEX IF NOT EXISTS check_jobs_workspace_status_due_idx ON ${q(schemaName, "check_jobs")} (workspace_id, status, due_at) WHERE deleted_at IS NULL;`,
    `CREATE INDEX IF NOT EXISTS report_schedules_due_idx ON ${q(schemaName, "report_schedules")} (workspace_id, enabled, next_run_at, lease_expires_at) WHERE deleted_at IS NULL;`,
    `CREATE INDEX IF NOT EXISTS report_runs_workspace_status_time_idx ON ${q(schemaName, "report_runs")} (workspace_id, status, started_at DESC) WHERE deleted_at IS NULL;`,
    `CREATE INDEX IF NOT EXISTS report_delivery_attempts_run_idx ON ${q(schemaName, "report_delivery_attempts")} (workspace_id, report_run_id, status, scheduled_at) WHERE deleted_at IS NULL;`,
    `CREATE INDEX IF NOT EXISTS report_delivery_attempts_due_idx ON ${q(schemaName, "report_delivery_attempts")} (workspace_id, status, COALESCE(next_retry_at, scheduled_at)) WHERE deleted_at IS NULL;`,
    `CREATE UNIQUE INDEX IF NOT EXISTS report_delivery_attempts_idempotency_idx ON ${q(schemaName, "report_delivery_attempts")} (workspace_id, idempotency_key) WHERE deleted_at IS NULL;`,
    `CREATE INDEX IF NOT EXISTS report_artifacts_run_idx ON ${q(schemaName, "report_artifacts")} (workspace_id, report_run_id, artifact_type) WHERE deleted_at IS NULL;`,
    `CREATE INDEX IF NOT EXISTS audit_events_workspace_time_idx ON ${q(schemaName, "audit_events")} (workspace_id, created_at DESC) WHERE deleted_at IS NULL;`,
  ];
}

function buildSchemaUpgradeStatements(schemaName: string): string[] {
  const checkJobs = q(schemaName, "check_jobs");
  const monitors = q(schemaName, "monitors");
  const probeIdentities = q(schemaName, "probe_identities");
  const probeSubmissions = q(schemaName, "probe_submissions");
  const reportSchedules = q(schemaName, "report_schedules");
  return [
    `ALTER TABLE ${checkJobs} ADD COLUMN IF NOT EXISTS monitor_snapshot jsonb;`,
    `UPDATE ${checkJobs} AS job
SET monitor_snapshot = jsonb_build_object(
  'workspaceId', monitor.workspace_id,
  'id', monitor.id,
  'name', monitor.name,
  'kind', monitor.kind,
  'url', monitor.url,
  'host', monitor.host,
  'port', monitor.port,
  'method', monitor.method,
  'expectedStatus', monitor.expected_status,
  'intervalSeconds', monitor.interval_seconds,
  'timeoutMs', monitor.timeout_ms,
  'retryCount', monitor.retry_count,
  'enabled', monitor.enabled,
  'status', monitor.status,
  'lastCheckedAt', monitor.last_checked_at,
  'revision', monitor.version,
  'createdAt', monitor.created_at,
  'updatedAt', monitor.updated_at
)
FROM ${monitors} AS monitor
WHERE job.workspace_id = monitor.workspace_id
  AND job.monitor_id = monitor.id
  AND job.monitor_version = monitor.version
  AND job.monitor_snapshot IS NULL;`,
    `UPDATE ${checkJobs} SET monitor_snapshot = '{}'::jsonb WHERE monitor_snapshot IS NULL;`,
    `UPDATE ${checkJobs}
SET status = 'cancelled',
    updated_at = now(),
    version = version + 1
WHERE monitor_snapshot = '{}'::jsonb
  AND status IN ('pending', 'claimed', 'expired');`,
    `ALTER TABLE ${checkJobs} ALTER COLUMN monitor_snapshot SET NOT NULL;`,
    `ALTER TABLE ${checkJobs} ALTER COLUMN monitor_snapshot DROP DEFAULT;`,
    `ALTER TABLE ${probeIdentities} ADD COLUMN IF NOT EXISTS probe_location text;`,
    `UPDATE ${probeIdentities} SET probe_location = 'default' WHERE probe_location IS NULL;`,
    `ALTER TABLE ${probeIdentities} ALTER COLUMN probe_location SET DEFAULT 'default';`,
    `ALTER TABLE ${probeIdentities} ALTER COLUMN probe_location SET NOT NULL;`,
    `ALTER TABLE ${probeSubmissions} ADD COLUMN IF NOT EXISTS monitor_revision bigint;`,
    `UPDATE ${probeSubmissions} SET monitor_revision = 1 WHERE monitor_revision IS NULL;`,
    `ALTER TABLE ${probeSubmissions} ALTER COLUMN monitor_revision SET DEFAULT 1;`,
    `ALTER TABLE ${probeSubmissions} ALTER COLUMN monitor_revision SET NOT NULL;`,
    `ALTER TABLE ${probeSubmissions} ADD COLUMN IF NOT EXISTS schedule_slot timestamptz;`,
    `UPDATE ${probeSubmissions} SET schedule_slot = checked_at WHERE schedule_slot IS NULL;`,
    `ALTER TABLE ${probeSubmissions} ALTER COLUMN schedule_slot SET NOT NULL;`,
    `ALTER TABLE ${probeSubmissions} ADD COLUMN IF NOT EXISTS probe_class text;`,
    `UPDATE ${probeSubmissions} SET probe_class = 'private' WHERE probe_class IS NULL;`,
    `ALTER TABLE ${probeSubmissions} ALTER COLUMN probe_class SET NOT NULL;`,
    `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'probe_submissions_probe_class_check'
      AND conrelid = ${sqlLiteral(`${schemaName}.probe_submissions`)}::regclass
  ) THEN
    ALTER TABLE ${probeSubmissions}
      ADD CONSTRAINT probe_submissions_probe_class_check CHECK (probe_class IN ('public', 'private')) NOT VALID;
  END IF;
END $$;`,
    `ALTER TABLE ${probeSubmissions} VALIDATE CONSTRAINT probe_submissions_probe_class_check;`,
    `ALTER TABLE ${probeSubmissions} ADD COLUMN IF NOT EXISTS probe_location text;`,
    `UPDATE ${probeSubmissions} SET probe_location = 'default' WHERE probe_location IS NULL;`,
    `ALTER TABLE ${probeSubmissions} ALTER COLUMN probe_location SET DEFAULT 'default';`,
    `ALTER TABLE ${probeSubmissions} ALTER COLUMN probe_location SET NOT NULL;`,
    `ALTER TABLE ${probeSubmissions} ADD COLUMN IF NOT EXISTS probe_policy_hash text;`,
    `UPDATE ${probeSubmissions} SET probe_policy_hash = 'legacy' WHERE probe_policy_hash IS NULL;`,
    `ALTER TABLE ${probeSubmissions} ALTER COLUMN probe_policy_hash SET NOT NULL;`,
    `ALTER TABLE ${probeSubmissions} ADD COLUMN IF NOT EXISTS payload_hash text;`,
    `UPDATE ${probeSubmissions} SET payload_hash = '' WHERE payload_hash IS NULL;`,
    `ALTER TABLE ${probeSubmissions} ALTER COLUMN payload_hash SET DEFAULT '';`,
    `ALTER TABLE ${probeSubmissions} ALTER COLUMN payload_hash SET NOT NULL;`,
    `ALTER TABLE ${reportSchedules} ADD COLUMN IF NOT EXISTS claimed_by_worker_id text;`,
    `ALTER TABLE ${reportSchedules} ADD COLUMN IF NOT EXISTS fencing_token text;`,
    `ALTER TABLE ${reportSchedules} ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;`,
  ];
}

function buildRlsStatements(schemaName: string, workspaceSetting: string): string[] {
  const currentWorkspace = `current_setting('${workspaceSetting}', true)`;
  const schemaLiteral = sqlLiteral(schemaName);
  return RLS_TABLES.flatMap((tableName) => [
    `ALTER TABLE ${q(schemaName, tableName)} ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE ${q(schemaName, tableName)} FORCE ROW LEVEL SECURITY;`,
    `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = ${schemaLiteral}
      AND tablename = ${sqlLiteral(tableName)}
      AND policyname = ${sqlLiteral(policyNameFor(tableName))}
  ) THEN
    CREATE POLICY ${quoteIdentifier(policyNameFor(tableName))} ON ${q(schemaName, tableName)}
  USING (workspace_id = ${currentWorkspace})
  WITH CHECK (workspace_id = ${currentWorkspace});
  END IF;
END $$;`,
  ]);
}

function expectedRlsPolicies(): string[] {
  return RLS_TABLES.map(policyNameFor);
}

function policyNameFor(tableName: string): string {
  return `${tableName}_workspace_scope`;
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
