import { createHash, randomUUID } from "node:crypto";
import { createPostgresPool, type PostgresQueryClient } from "./postgres.js";
import { buildPostgresMigrationPlan, redactPostgresUrl } from "./postgres-plan.js";
import { probeResultPayloadHash } from "./probes.js";
import type {
  CheckEvidence,
  CheckStatus,
  MonitorKind,
  MonitorStatus,
  ProbeCheckJobStatus,
  ProbeClass,
  ProbePolicy,
} from "./types.js";

export const POSTGRES_RUNTIME_VERSION = 1;

export interface PostgresRuntimeOptions {
  databaseUrl?: string;
  schemaName?: string;
  workspaceId?: string;
  workspaceSetting?: string;
  client?: PostgresQueryClient;
  now?: () => Date;
}

export interface PostgresRuntimeReadiness {
  kind: "open-uptime.postgres-runtime-readiness";
  version: number;
  status: "ready" | "blocked";
  canUseCoreRuntime: boolean;
  canPromoteHostedWorkers: false;
  schemaName: string;
  workspaceId: string | null;
  database: {
    configured: boolean;
    redactedUrl: string | null;
  };
  checks: Array<{ name: string; ok: boolean; detail: string }>;
  blockers: string[];
  capabilities: {
    monitorStore: boolean;
    probeIdentityStore: boolean;
    checkJobLeases: boolean;
    checkResultWriter: boolean;
    auditWriter: boolean;
    tombstoneWriter: boolean;
  };
}

export interface UpsertPostgresMonitorInput {
  id?: string;
  workspaceId?: string;
  name: string;
  kind: MonitorKind;
  url?: string | null;
  host?: string | null;
  port?: number | null;
  method?: string;
  expectedStatus?: number | null;
  intervalSeconds?: number;
  timeoutMs?: number;
  retryCount?: number;
  enabled?: boolean;
  status?: MonitorStatus;
  lastCheckedAt?: string | null;
  actor?: string | null;
  origin?: string | null;
  idempotencyKey?: string | null;
}

export interface PostgresMonitorRecord {
  workspaceId: string;
  id: string;
  name: string;
  kind: MonitorKind;
  url: string | null;
  host: string | null;
  port: number | null;
  method: string;
  expectedStatus: number | null;
  intervalSeconds: number;
  timeoutMs: number;
  retryCount: number;
  enabled: boolean;
  status: MonitorStatus;
  lastCheckedAt: string | null;
  revision: number;
  actor: string | null;
  origin: string | null;
  idempotencyKey: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface UpsertPostgresProbeIdentityInput {
  id?: string;
  workspaceId?: string;
  name: string;
  probeClass: ProbeClass;
  probeLocation?: string;
  machineId?: string | null;
  publicKeyPem: string;
  publicKeyFingerprint: string;
  enabled?: boolean;
  capabilities?: Record<string, unknown>;
  lastSeenAt?: string | null;
  actor?: string | null;
  origin?: string | null;
  idempotencyKey?: string | null;
}

export interface PostgresProbeIdentityRecord {
  workspaceId: string;
  id: string;
  name: string;
  probeClass: ProbeClass;
  probeLocation: string;
  machineId: string | null;
  publicKeyPem: string;
  publicKeyFingerprint: string;
  enabled: boolean;
  capabilities: Record<string, unknown>;
  lastSeenAt: string | null;
  version: number;
}

export interface CreatePostgresCheckJobInput {
  id?: string;
  workspaceId?: string;
  monitorId: string;
  monitorRevision: number;
  scheduleSlot: string;
  dueAt?: string;
  probePolicy?: ProbePolicy;
  deployGeneration?: number;
  actor?: string | null;
  origin?: string | null;
  idempotencyKey?: string | null;
}

export interface PostgresMonitorSnapshot {
  workspaceId: string;
  id: string;
  name: string;
  kind: MonitorKind;
  url: string | null;
  host: string | null;
  port: number | null;
  method: string;
  expectedStatus: number | null;
  intervalSeconds: number;
  timeoutMs: number;
  retryCount: number;
  enabled: boolean;
  status: MonitorStatus;
  lastCheckedAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ClaimPostgresCheckJobInput {
  workspaceId?: string;
  jobId: string;
  probeId: string;
  leaseTtlMs?: number;
}

export interface CancelPostgresClaimedCheckJobInput {
  workspaceId?: string;
  jobId: string;
  probeId: string;
  fencingToken: string;
  reason?: string | null;
  actor?: string | null;
  origin?: string | null;
  idempotencyKey?: string | null;
}

export interface ListDuePostgresCheckJobsOptions {
  workspaceId?: string;
  now?: string;
  limit?: number;
}

export interface GetPostgresMonitorOptions {
  workspaceId?: string;
  id: string;
}

export interface PostgresCheckJobRecord {
  workspaceId: string;
  id: string;
  monitorId: string;
  monitorRevision: number;
  monitorSnapshot: PostgresMonitorSnapshot;
  scheduleSlot: string;
  probePolicy: ProbePolicy;
  probePolicyHash: string;
  status: ProbeCheckJobStatus;
  claimedByProbeId: string | null;
  fencingToken: string | null;
  dueAt: string;
  claimedAt: string | null;
  leaseExpiresAt: string | null;
  submittedResultId: string | null;
  deployGeneration: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SubmitPostgresProbeCheckResultInput {
  workspaceId?: string;
  jobId: string;
  probeId: string;
  fencingToken: string;
  nonce: string;
  checkedAt: string;
  status: CheckStatus;
  latencyMs?: number | null;
  statusCode?: number | null;
  error?: string | null;
  attemptCount?: number;
  evidence?: CheckEvidence | null;
  payloadHash: string;
  actor?: string | null;
  origin?: string | null;
  idempotencyKey?: string | null;
}

export interface PostgresCheckResultRecord {
  workspaceId: string;
  id: string;
  monitorId: string;
  jobId: string | null;
  probeId: string | null;
  monitorRevision: number;
  scheduleSlot: string;
  probeClass: ProbeClass;
  probeLocation: string;
  probePolicyHash: string;
  checkedAt: string;
  status: CheckStatus;
  latencyMs: number | null;
  statusCode: number | null;
  error: string | null;
  attemptCount: number;
  evidence: CheckEvidence | null;
  actor: string | null;
  origin: string | null;
  idempotencyKey: string | null;
}

export interface PostgresProbeSubmissionRecord {
  workspaceId: string;
  id: string;
  probeId: string;
  jobId: string;
  monitorId: string;
  monitorRevision: number;
  scheduleSlot: string;
  probeClass: ProbeClass;
  probeLocation: string;
  probePolicyHash: string;
  payloadHash: string;
  checkResultId: string;
  nonce: string;
  checkedAt: string;
  submittedAt: string;
}

export interface SubmitPostgresProbeCheckResult {
  job: PostgresCheckJobRecord;
  result: PostgresCheckResultRecord;
  submission: PostgresProbeSubmissionRecord;
}

export interface RecordPostgresAuditEventInput {
  id?: string;
  workspaceId?: string;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  message?: string | null;
  metadata?: Record<string, unknown>;
  actor?: string | null;
  origin?: string | null;
  idempotencyKey?: string | null;
  createdAt?: string;
}

export interface PostgresAuditEventRecord {
  workspaceId: string;
  id: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  message: string | null;
  metadata: Record<string, unknown>;
  actor: string | null;
  origin: string | null;
  idempotencyKey: string | null;
  createdAt: string;
}

export interface TombstonePostgresResourceInput {
  workspaceId?: string;
  resourceType: "monitor" | "check_job" | "probe_identity" | "report_schedule" | "incident";
  resourceId: string;
  version?: number;
  deletedAt?: string;
  actor?: string | null;
  origin?: string | null;
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown>;
}

export interface PostgresSyncTombstoneRecord {
  workspaceId: string;
  resourceType: string;
  resourceId: string;
  deletedAt: string;
  version: number;
  actor: string | null;
  origin: string | null;
  idempotencyKey: string | null;
  metadata: Record<string, unknown>;
}

export class PostgresRuntime {
  private readonly client: PostgresRuntimeClient;
  private readonly ownedClient: PostgresRuntimeClient | null;
  private readonly schemaName: string;
  private readonly workspaceId: string;
  private readonly workspaceSetting: string;
  private readonly clock: () => Date;

  constructor(options: PostgresRuntimeOptions = {}) {
    this.schemaName = normalizeSchemaName(options.schemaName ?? "uptime");
    const resolvedWorkspaceId = options.workspaceId ?? process.env.HASNA_UPTIME_WORKSPACE_ID;
    if ((process.env.HASNA_UPTIME_MODE ?? "").trim() === "hosted" && !resolvedWorkspaceId) {
      throw new Error("Postgres runtime requires HASNA_UPTIME_WORKSPACE_ID or workspaceId in hosted mode");
    }
    this.workspaceId = normalizeWorkspaceId(resolvedWorkspaceId ?? "default");
    this.workspaceSetting = normalizeWorkspaceSetting(options.workspaceSetting ?? "app.workspace_id");
    this.clock = options.now ?? (() => new Date());
    if (options.client) {
      this.client = options.client;
      this.ownedClient = null;
    } else {
      const databaseUrl = options.databaseUrl ?? process.env.HASNA_UPTIME_DATABASE_URL;
      if (!databaseUrl) throw new Error("HASNA_UPTIME_DATABASE_URL is required for Postgres runtime");
      const plan = buildPostgresMigrationPlan({
        databaseUrl,
        schemaName: this.schemaName,
        workspaceSetting: this.workspaceSetting,
      });
      if (!plan.database.validPostgresUrl || !plan.database.tlsRequired) {
        throw new Error("Postgres runtime requires a postgres:// or postgresql:// URL with sslmode=require, sslmode=verify-full, or ssl=true");
      }
      this.client = createPostgresPool(databaseUrl) as PostgresRuntimeClient;
      this.ownedClient = this.client;
    }
  }

  async close(): Promise<void> {
    await this.ownedClient?.end?.();
  }

  async upsertMonitor(input: UpsertPostgresMonitorInput): Promise<PostgresMonitorRecord> {
    const workspaceId = normalizeWorkspaceId(input.workspaceId ?? this.workspaceId);
    const idempotencyKey = normalizeNullableOpaqueText(input.idempotencyKey, "monitor idempotency key", 256);
    const id = normalizeId(input.id ?? deterministicId("mon", workspaceId, idempotencyKey ?? input.name, input.kind));
    const kind = normalizeMonitorKind(input.kind);
    const result = await this.withWorkspaceTransaction(workspaceId, (client) => client.query(
      `INSERT INTO ${this.table("monitors")} (
        workspace_id, id, name, kind, url, host, port, method, expected_status,
        interval_seconds, timeout_ms, retry_count, enabled, status, last_checked_at,
        actor, origin, idempotency_key
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::timestamptz, $16, $17, $18)
      ON CONFLICT (workspace_id, id) DO UPDATE SET
        name = EXCLUDED.name,
        kind = EXCLUDED.kind,
        url = EXCLUDED.url,
        host = EXCLUDED.host,
        port = EXCLUDED.port,
        method = EXCLUDED.method,
        expected_status = EXCLUDED.expected_status,
        interval_seconds = EXCLUDED.interval_seconds,
        timeout_ms = EXCLUDED.timeout_ms,
        retry_count = EXCLUDED.retry_count,
        enabled = EXCLUDED.enabled,
        status = EXCLUDED.status,
        last_checked_at = EXCLUDED.last_checked_at,
        actor = EXCLUDED.actor,
        origin = EXCLUDED.origin,
        idempotency_key = EXCLUDED.idempotency_key,
        deleted_at = NULL,
        updated_at = now(),
        version = ${this.table("monitors")}.version + 1
      WHERE ${this.table("monitors")}.idempotency_key IS NULL
         OR EXCLUDED.idempotency_key IS NULL
         OR ${this.table("monitors")}.idempotency_key IS NOT DISTINCT FROM EXCLUDED.idempotency_key
      RETURNING *`,
      [
        workspaceId,
        id,
        normalizeName(input.name, "monitor name"),
        kind,
        normalizeNullableMonitorUrl(input.url),
        normalizeNullableHost(input.host),
        normalizeNullablePort(input.port),
        normalizeMethod(input.method ?? "GET"),
        normalizeNullableExpectedStatus(input.expectedStatus),
        normalizePositiveInteger(input.intervalSeconds ?? 60, "monitor intervalSeconds"),
        normalizePositiveInteger(input.timeoutMs ?? 5000, "monitor timeoutMs"),
        normalizeNonNegativeInteger(input.retryCount ?? 0, "monitor retryCount"),
        input.enabled ?? true,
        normalizeMonitorStatus(input.status ?? "unknown"),
        normalizeNullableIsoTimestamp(input.lastCheckedAt, "monitor lastCheckedAt"),
        normalizeNullableOpaqueText(input.actor, "monitor actor", 160),
        normalizeNullableOpaqueText(input.origin, "monitor origin", 160),
        idempotencyKey,
      ],
    ));
    return monitorFromRow(firstRow(result, "monitor"));
  }

  async upsertProbeIdentity(input: UpsertPostgresProbeIdentityInput): Promise<PostgresProbeIdentityRecord> {
    const workspaceId = normalizeWorkspaceId(input.workspaceId ?? this.workspaceId);
    const idempotencyKey = normalizeNullableOpaqueText(input.idempotencyKey, "probe idempotency key", 256);
    const id = normalizeId(input.id ?? deterministicId("prb", workspaceId, input.publicKeyFingerprint));
    const result = await this.withWorkspaceTransaction(workspaceId, (client) => client.query(
      `INSERT INTO ${this.table("probe_identities")} (
        workspace_id, id, name, probe_class, probe_location, machine_id, public_key_pem,
        public_key_fingerprint, enabled, capabilities, last_seen_at, actor, origin, idempotency_key
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::timestamptz, $12, $13, $14)
      ON CONFLICT (workspace_id, id) DO UPDATE SET
        name = EXCLUDED.name,
        probe_class = EXCLUDED.probe_class,
        probe_location = EXCLUDED.probe_location,
        machine_id = EXCLUDED.machine_id,
        public_key_pem = EXCLUDED.public_key_pem,
        public_key_fingerprint = EXCLUDED.public_key_fingerprint,
        enabled = EXCLUDED.enabled,
        capabilities = EXCLUDED.capabilities,
        last_seen_at = EXCLUDED.last_seen_at,
        actor = EXCLUDED.actor,
        origin = EXCLUDED.origin,
        idempotency_key = EXCLUDED.idempotency_key,
        deleted_at = NULL,
        updated_at = now(),
        version = ${this.table("probe_identities")}.version + 1
      WHERE ${this.table("probe_identities")}.idempotency_key IS NULL
         OR EXCLUDED.idempotency_key IS NULL
         OR ${this.table("probe_identities")}.idempotency_key IS NOT DISTINCT FROM EXCLUDED.idempotency_key
      RETURNING *`,
      [
        workspaceId,
        id,
        normalizeName(input.name, "probe name"),
        normalizeProbeClass(input.probeClass),
        normalizeProbeLocation(input.probeLocation ?? "default"),
        normalizeNullableOpaqueText(input.machineId, "probe machine id", 160),
        normalizePublicKeyPem(input.publicKeyPem),
        normalizeSha256(input.publicKeyFingerprint, "probe public key fingerprint"),
        input.enabled ?? true,
        JSON.stringify(normalizeMetadata(input.capabilities ?? {}, "probe capabilities")),
        normalizeNullableIsoTimestamp(input.lastSeenAt, "probe lastSeenAt"),
        normalizeNullableOpaqueText(input.actor, "probe actor", 160),
        normalizeNullableOpaqueText(input.origin, "probe origin", 160),
        idempotencyKey,
      ],
    ));
    return probeIdentityFromRow(firstRow(result, "probe identity"));
  }

  async getMonitor(input: GetPostgresMonitorOptions): Promise<PostgresMonitorRecord | null> {
    const workspaceId = normalizeWorkspaceId(input.workspaceId ?? this.workspaceId);
    const id = normalizeId(input.id);
    const result = await this.withWorkspaceTransaction(workspaceId, (client) => client.query(
      `SELECT * FROM ${this.table("monitors")}
       WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [workspaceId, id],
    ));
    const row = result.rows[0];
    return row ? monitorFromRow(row as Record<string, unknown>) : null;
  }

  async createCheckJob(input: CreatePostgresCheckJobInput): Promise<PostgresCheckJobRecord> {
    const workspaceId = normalizeWorkspaceId(input.workspaceId ?? this.workspaceId);
    const monitorId = normalizeId(input.monitorId);
    const monitorRevision = normalizePositiveInteger(input.monitorRevision, "monitorRevision");
    const scheduleSlot = normalizeIsoTimestamp(input.scheduleSlot, "check job scheduleSlot");
    const dueAt = normalizeIsoTimestamp(input.dueAt ?? scheduleSlot, "check job dueAt");
    const probePolicy = normalizeProbePolicy(input.probePolicy);
    const probePolicyHash = hashProbePolicy(probePolicy);
    const id = normalizeId(input.id ?? deterministicProbeJobId({
      workspaceId,
      monitorId,
      monitorRevision,
      scheduleSlot,
      probePolicyHash,
    }));
    const result = await this.withWorkspaceTransaction(workspaceId, async (client) => {
      const monitorResult = await client.query(
        `SELECT * FROM ${this.table("monitors")}
         WHERE workspace_id = $1
           AND id = $2
           AND version = $3
           AND enabled = true
           AND deleted_at IS NULL`,
        [workspaceId, monitorId, monitorRevision],
      );
      const monitorSnapshot = monitorSnapshotFromMonitor(monitorFromRow(firstRow(monitorResult, "monitor snapshot")));
      return client.query(
        `INSERT INTO ${this.table("check_jobs")} (
          workspace_id, id, monitor_id, monitor_version, monitor_snapshot, schedule_slot, probe_policy,
          probe_policy_hash, status, due_at, deploy_generation, actor, origin, idempotency_key
        ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz, $7::jsonb, $8, 'pending', $9::timestamptz, $10, $11, $12, $13)
        ON CONFLICT (workspace_id, monitor_id, monitor_version, schedule_slot, probe_policy_hash) DO UPDATE SET
          updated_at = ${this.table("check_jobs")}.updated_at
        WHERE ${this.table("check_jobs")}.deleted_at IS NULL
        RETURNING *`,
        [
          workspaceId,
          id,
          monitorId,
          monitorRevision,
          JSON.stringify(monitorSnapshot),
          scheduleSlot,
          JSON.stringify(probePolicy),
          probePolicyHash,
          dueAt,
          normalizeNonNegativeInteger(input.deployGeneration ?? 0, "deployGeneration"),
          normalizeNullableOpaqueText(input.actor, "check job actor", 160),
          normalizeNullableOpaqueText(input.origin, "check job origin", 160),
          normalizeNullableOpaqueText(input.idempotencyKey, "check job idempotency key", 256),
        ],
      );
    });
    return checkJobFromRow(firstRow(result, "check job"));
  }

  async listDueCheckJobs(options: ListDuePostgresCheckJobsOptions = {}): Promise<PostgresCheckJobRecord[]> {
    const workspaceId = normalizeWorkspaceId(options.workspaceId ?? this.workspaceId);
    const now = normalizeIsoTimestamp(options.now ?? this.clock().toISOString(), "due check job now");
    const limit = clampLimit(options.limit ?? 50);
    const result = await this.withWorkspaceTransaction(workspaceId, (client) => client.query(
      `SELECT * FROM ${this.table("check_jobs")}
       WHERE workspace_id = $1
         AND deleted_at IS NULL
         AND submitted_result_id IS NULL
         AND monitor_snapshot <> '{}'::jsonb
         AND due_at <= $2::timestamptz
         AND (
           status IN ('pending', 'expired')
           OR (status = 'claimed' AND lease_expires_at <= $2::timestamptz)
         )
       ORDER BY due_at ASC, created_at ASC, id ASC
       LIMIT $3`,
      [workspaceId, now, limit],
    ));
    return result.rows.map((row) => redactCheckJobForDiscovery(checkJobFromRow(row as Record<string, unknown>)));
  }

  async claimCheckJob(input: ClaimPostgresCheckJobInput): Promise<PostgresCheckJobRecord | null> {
    const workspaceId = normalizeWorkspaceId(input.workspaceId ?? this.workspaceId);
    const jobId = normalizeId(input.jobId);
    const probeId = normalizeId(input.probeId);
    const leaseTtlMs = normalizePositiveInteger(input.leaseTtlMs ?? 120_000, "leaseTtlMs");
    const fencingToken = `fence_${randomUUID().replace(/-/g, "")}`;
    return this.withWorkspaceTransaction(workspaceId, async (client) => {
      const result = await client.query(
        `WITH probe AS (
         SELECT id, probe_class, probe_location
         FROM ${this.table("probe_identities")}
         WHERE workspace_id = $1 AND id = $3 AND enabled = true AND deleted_at IS NULL
       )
       UPDATE ${this.table("check_jobs")} AS job
       SET status = 'claimed',
           claimed_by_probe_id = probe.id,
           fencing_token = CASE
             WHEN job.status = 'claimed' AND job.claimed_by_probe_id = probe.id AND job.lease_expires_at > now()
             THEN job.fencing_token
             ELSE $4
           END,
           claimed_at = CASE
             WHEN job.status = 'claimed' AND job.claimed_by_probe_id = probe.id AND job.lease_expires_at > now()
             THEN job.claimed_at
             ELSE now()
           END,
           lease_expires_at = CASE
             WHEN job.status = 'claimed' AND job.claimed_by_probe_id = probe.id AND job.lease_expires_at > now()
             THEN job.lease_expires_at
             ELSE now() + ($5::bigint * interval '1 millisecond')
           END,
           updated_at = CASE
             WHEN job.status = 'claimed' AND job.claimed_by_probe_id = probe.id AND job.lease_expires_at > now()
             THEN job.updated_at
             ELSE now()
           END,
           version = CASE
             WHEN job.status = 'claimed' AND job.claimed_by_probe_id = probe.id AND job.lease_expires_at > now()
             THEN job.version
             ELSE job.version + 1
           END
       FROM probe
       WHERE job.workspace_id = $1
         AND job.id = $2
         AND job.deleted_at IS NULL
         AND job.submitted_result_id IS NULL
         AND job.monitor_snapshot <> '{}'::jsonb
         AND job.due_at <= now()
         AND (
           job.status IN ('pending', 'expired')
           OR (job.status = 'claimed' AND (job.claimed_by_probe_id = probe.id OR job.lease_expires_at <= now()))
         )
         AND COALESCE(job.probe_policy->>'probeClass', job.probe_policy->>'probe_class') = probe.probe_class
         AND (
           jsonb_array_length(COALESCE(job.probe_policy->'locations', '[]'::jsonb)) = 0
           OR (job.probe_policy->'locations') ? probe.probe_location
         )
       RETURNING job.*`,
        [workspaceId, jobId, probeId, fencingToken, leaseTtlMs],
      );
      const row = result.rows[0];
      return row ? checkJobFromRow(row as Record<string, unknown>) : null;
    });
  }

  async cancelClaimedCheckJob(input: CancelPostgresClaimedCheckJobInput): Promise<PostgresCheckJobRecord | null> {
    const workspaceId = normalizeWorkspaceId(input.workspaceId ?? this.workspaceId);
    const jobId = normalizeId(input.jobId);
    const probeId = normalizeId(input.probeId);
    const result = await this.withWorkspaceTransaction(workspaceId, (client) => client.query(
      `UPDATE ${this.table("check_jobs")}
       SET status = 'cancelled',
           fencing_token = NULL,
           lease_expires_at = NULL,
           actor = $5,
           origin = $6,
           idempotency_key = $7,
           updated_at = now(),
           version = version + 1
       WHERE workspace_id = $1
         AND id = $2
         AND deleted_at IS NULL
         AND status = 'claimed'
         AND claimed_by_probe_id = $3
         AND fencing_token = $4
         AND lease_expires_at > now()
         AND submitted_result_id IS NULL
       RETURNING *`,
      [
        workspaceId,
        jobId,
        probeId,
        normalizeOpaqueText(input.fencingToken, "fencing token", 160),
        normalizeNullableOpaqueText(input.actor, "check job cancel actor", 160),
        normalizeNullableOpaqueText(input.origin, "check job cancel origin", 160),
        normalizeNullableOpaqueText(input.idempotencyKey ?? input.reason, "check job cancel idempotency key", 256),
      ],
    ));
    const row = result.rows[0];
    return row ? checkJobFromRow(row as Record<string, unknown>) : null;
  }

  async submitProbeCheckResult(input: SubmitPostgresProbeCheckResultInput): Promise<SubmitPostgresProbeCheckResult> {
    const workspaceId = normalizeWorkspaceId(input.workspaceId ?? this.workspaceId);
    const jobId = normalizeId(input.jobId);
    const probeId = normalizeId(input.probeId);
    const checkedAt = normalizeIsoTimestamp(input.checkedAt, "probe checkedAt");
    const suppliedPayloadHash = normalizeSha256(input.payloadHash, "probe payload hash");
    const evidence = input.evidence == null ? null : normalizeEvidence(input.evidence);
    const normalizedNonce = normalizeNonce(input.nonce);
    const fencingToken = normalizeOpaqueText(input.fencingToken, "fencing token", 160);
    const status = normalizeCheckStatus(input.status);
    const latencyMs = normalizeNullableNonNegativeNumber(input.latencyMs, "latencyMs");
    const statusCode = normalizeNullableExpectedStatus(input.statusCode);
    const error = normalizeNullableRedactedText(input.error, "check result error", 1000);
    const attemptCount = normalizePositiveInteger(input.attemptCount ?? 1, "attemptCount");
    return this.withWorkspaceTransaction(workspaceId, async (client) => {
      const jobResult = await client.query(
        `SELECT * FROM ${this.table("check_jobs")}
         WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL
         FOR UPDATE`,
        [workspaceId, jobId],
      );
      const currentJob = jobResult.rows[0] ? checkJobFromRow(jobResult.rows[0] as Record<string, unknown>) : null;
      if (!currentJob) throw new Error("probe check job not found");
      const payloadHash = probeResultPayloadHash({
        probeId,
        jobId: currentJob.id,
        scheduleSlot: currentJob.scheduleSlot,
        fencingToken,
        monitorId: currentJob.monitorId,
        nonce: normalizedNonce,
        checkedAt,
        status,
        latencyMs,
        statusCode,
        error,
        attemptCount,
        monitorRevision: currentJob.monitorRevision,
        evidence,
      });
      if (suppliedPayloadHash !== payloadHash) {
        throw new Error("probe payload hash mismatch");
      }
      const resultId = deterministicId("chk", workspaceId, currentJob.id, probeId, payloadHash);
      const submissionId = deterministicId("psb", workspaceId, probeId, normalizedNonce);
      const existingSubmission = await client.query(
        `SELECT * FROM ${this.table("probe_submissions")}
         WHERE workspace_id = $1 AND probe_id = $2 AND nonce = $3 AND deleted_at IS NULL`,
        [workspaceId, probeId, normalizedNonce],
      );
      const existing = existingSubmission.rows[0] as Record<string, unknown> | undefined;
      if (existing && String(existing.payload_hash ?? "") !== payloadHash) {
        throw new Error("probe submission nonce replay conflict");
      }
      const existingSubmissionRecord = existing ? probeSubmissionFromRow(existing) : null;
      if (existingSubmissionRecord) {
        if (currentJob.submittedResultId !== existingSubmissionRecord.checkResultId) {
          throw new Error("probe submission replay conflict");
        }
        const existingResult = await client.query(
          `SELECT * FROM ${this.table("check_results")}
           WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [workspaceId, existingSubmissionRecord.checkResultId],
        );
        return {
          job: currentJob,
          result: checkResultFromRow(firstRow(existingResult, "check result")),
          submission: existingSubmissionRecord,
        };
      }
      const probeResult = await client.query(
        `SELECT id, probe_class, probe_location
         FROM ${this.table("probe_identities")}
         WHERE workspace_id = $1 AND id = $2 AND enabled = true AND deleted_at IS NULL`,
        [workspaceId, probeId],
      );
      const probeRow = probeResult.rows[0] as Record<string, unknown> | undefined;
      if (!probeRow) throw new Error("probe identity not found");
      const submittedProbeClass = normalizeProbeClass(stringField(probeRow.probe_class));
      const submittedProbeLocation = normalizeProbeLocation(stringField(probeRow.probe_location ?? "default"));
      if (submittedProbeClass !== currentJob.probePolicy.probeClass) {
        throw new Error("probe class does not match check job policy");
      }
      if (currentJob.probePolicy.locations.length > 0 && !currentJob.probePolicy.locations.includes(submittedProbeLocation)) {
        throw new Error("probe location does not match check job policy");
      }
      const monitorUpdate = await client.query(
        `UPDATE ${this.table("monitors")}
         SET status = $3,
             last_checked_at = $4::timestamptz,
             updated_at = now()
         WHERE workspace_id = $1
           AND id = $2
           AND version = $5
           AND enabled = true
           AND deleted_at IS NULL
         RETURNING *`,
        [
          workspaceId,
          currentJob.monitorId,
          normalizeMonitorStatus(status === "up" ? "up" : "down"),
          checkedAt,
          currentJob.monitorRevision,
        ],
      );
      if (!monitorUpdate.rows[0]) {
        throw new Error("monitor changed since check job was created");
      }
      const result = await client.query(
        `INSERT INTO ${this.table("check_results")} (
          workspace_id, id, monitor_id, job_id, probe_id, monitor_version,
          schedule_slot, probe_class, probe_location, probe_policy_hash, checked_at,
          status, latency_ms, status_code, error, attempt_count, evidence_json,
          actor, origin, idempotency_key
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9, $10, $11::timestamptz,
          $12, $13, $14, $15, $16, $17::jsonb, $18, $19, $20)
        ON CONFLICT (workspace_id, id) DO UPDATE SET
          idempotency_key = ${this.table("check_results")}.idempotency_key
        WHERE ${this.table("check_results")}.idempotency_key IS NOT DISTINCT FROM EXCLUDED.idempotency_key
        RETURNING *`,
        [
          workspaceId,
          resultId,
          currentJob.monitorId,
          currentJob.id,
          probeId,
          currentJob.monitorRevision,
          currentJob.scheduleSlot,
          submittedProbeClass,
          submittedProbeLocation,
          currentJob.probePolicyHash,
          checkedAt,
          status,
          latencyMs,
          statusCode,
          error,
          attemptCount,
          evidence == null ? null : JSON.stringify(evidence),
          normalizeNullableOpaqueText(input.actor, "check result actor", 160),
          normalizeNullableOpaqueText(input.origin, "check result origin", 160),
          normalizeNullableOpaqueText(input.idempotencyKey, "check result idempotency key", 256),
        ],
      );
      const submission = await client.query(
        `INSERT INTO ${this.table("probe_submissions")} (
          workspace_id, id, probe_id, job_id, monitor_id, check_result_id, nonce,
          payload_hash, checked_at, submitted_at, actor, origin, idempotency_key,
          monitor_revision, schedule_slot, probe_class, probe_location, probe_policy_hash
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, now(), $10, $11, $12,
          $13, $14::timestamptz, $15, $16, $17)
        ON CONFLICT (workspace_id, probe_id, nonce) DO UPDATE SET
          payload_hash = ${this.table("probe_submissions")}.payload_hash
        WHERE ${this.table("probe_submissions")}.payload_hash IS NOT DISTINCT FROM EXCLUDED.payload_hash
        RETURNING *`,
        [
          workspaceId,
          submissionId,
          probeId,
          currentJob.id,
          currentJob.monitorId,
          resultId,
          normalizedNonce,
          payloadHash,
          checkedAt,
          normalizeNullableOpaqueText(input.actor, "probe submission actor", 160),
          normalizeNullableOpaqueText(input.origin, "probe submission origin", 160),
          normalizeNullableOpaqueText(input.idempotencyKey, "probe submission idempotency key", 256),
          currentJob.monitorRevision,
          currentJob.scheduleSlot,
          submittedProbeClass,
          submittedProbeLocation,
          currentJob.probePolicyHash,
        ],
      );
      const completed = await client.query(
        `UPDATE ${this.table("check_jobs")}
         SET status = 'submitted',
             submitted_result_id = $4,
             fencing_token = NULL,
             lease_expires_at = NULL,
             updated_at = now(),
             version = version + 1
         WHERE workspace_id = $1
           AND id = $2
           AND deleted_at IS NULL
           AND status = 'claimed'
           AND claimed_by_probe_id = $3
           AND fencing_token = $5
           AND lease_expires_at > now()
           AND submitted_result_id IS NULL
         RETURNING *`,
        [workspaceId, currentJob.id, probeId, resultId, fencingToken],
      );
      const completedJob = completed.rows[0];
      if (!completedJob) throw new Error("probe check job completion conflict");
      return {
        job: checkJobFromRow(completedJob as Record<string, unknown>),
        result: checkResultFromRow(firstRow(result, "check result")),
        submission: probeSubmissionFromRow(firstRow(submission, "probe submission")),
      };
    });
  }

  async recordAuditEvent(input: RecordPostgresAuditEventInput): Promise<PostgresAuditEventRecord> {
    const workspaceId = normalizeWorkspaceId(input.workspaceId ?? this.workspaceId);
    const createdAt = normalizeIsoTimestamp(input.createdAt ?? this.clock().toISOString(), "audit createdAt");
    const id = normalizeId(input.id ?? deterministicId("aud", workspaceId, input.action, input.resourceType ?? "", input.resourceId ?? "", createdAt));
    const result = await this.withWorkspaceTransaction(workspaceId, (client) => client.query(
      `INSERT INTO ${this.table("audit_events")} (
        workspace_id, id, action, resource_type, resource_id, message, metadata_json,
        actor, origin, idempotency_key, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11::timestamptz)
      ON CONFLICT (workspace_id, id) DO UPDATE SET
        idempotency_key = ${this.table("audit_events")}.idempotency_key
      WHERE ${this.table("audit_events")}.idempotency_key IS NOT DISTINCT FROM EXCLUDED.idempotency_key
      RETURNING *`,
      [
        workspaceId,
        id,
        normalizeOpaqueText(input.action, "audit action", 120),
        normalizeNullableOpaqueText(input.resourceType, "audit resource type", 120),
        normalizeNullableOpaqueText(input.resourceId, "audit resource id", 160),
        normalizeNullableRedactedText(input.message, "audit message", 1000),
        JSON.stringify(normalizeMetadata(input.metadata ?? {}, "audit metadata")),
        normalizeNullableOpaqueText(input.actor, "audit actor", 160),
        normalizeNullableOpaqueText(input.origin, "audit origin", 160),
        normalizeNullableOpaqueText(input.idempotencyKey, "audit idempotency key", 256),
        createdAt,
      ],
    ));
    return auditEventFromRow(firstRow(result, "audit event"));
  }

  async tombstoneResource(input: TombstonePostgresResourceInput): Promise<PostgresSyncTombstoneRecord> {
    const workspaceId = normalizeWorkspaceId(input.workspaceId ?? this.workspaceId);
    const resourceType = normalizeResourceType(input.resourceType);
    const resourceId = normalizeId(input.resourceId);
    const deletedAt = normalizeIsoTimestamp(input.deletedAt ?? this.clock().toISOString(), "tombstone deletedAt");
    const version = normalizePositiveInteger(input.version ?? 1, "tombstone version");
    const result = await this.withWorkspaceTransaction(workspaceId, async (client) => {
      const actor = normalizeNullableOpaqueText(input.actor, "tombstone actor", 160);
      const origin = normalizeNullableOpaqueText(input.origin, "tombstone origin", 160);
      const idempotencyKey = normalizeNullableOpaqueText(input.idempotencyKey, "tombstone idempotency key", 256);
      if (resourceType === "monitor") {
        await client.query(
          `UPDATE ${this.table("monitors")}
           SET deleted_at = $3::timestamptz,
               enabled = false,
               actor = $4,
               origin = $5,
               idempotency_key = $6,
               updated_at = now(),
               version = GREATEST(version + 1, $7)
           WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [
            workspaceId,
            resourceId,
            deletedAt,
            actor,
            origin,
            idempotencyKey,
            version,
          ],
        );
      } else if (resourceType === "check_job") {
        await client.query(
          `UPDATE ${this.table("check_jobs")}
           SET deleted_at = $3::timestamptz,
               status = CASE WHEN status = 'submitted' THEN status ELSE 'cancelled' END,
               actor = $4,
               origin = $5,
               idempotency_key = $6,
               updated_at = now(),
               version = GREATEST(version + 1, $7)
           WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [workspaceId, resourceId, deletedAt, actor, origin, idempotencyKey, version],
        );
      } else if (resourceType === "probe_identity") {
        await client.query(
          `UPDATE ${this.table("probe_identities")}
           SET deleted_at = $3::timestamptz,
               enabled = false,
               actor = $4,
               origin = $5,
               idempotency_key = $6,
               updated_at = now(),
               version = GREATEST(version + 1, $7)
           WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [workspaceId, resourceId, deletedAt, actor, origin, idempotencyKey, version],
        );
      } else if (resourceType === "report_schedule") {
        await client.query(
          `UPDATE ${this.table("report_schedules")}
           SET deleted_at = $3::timestamptz,
               enabled = false,
               actor = $4,
               origin = $5,
               idempotency_key = $6,
               updated_at = now(),
               version = GREATEST(version + 1, $7)
           WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [workspaceId, resourceId, deletedAt, actor, origin, idempotencyKey, version],
        );
      } else if (resourceType === "incident") {
        await client.query(
          `UPDATE ${this.table("incidents")}
           SET deleted_at = $3::timestamptz,
               status = CASE WHEN status IN ('resolved', 'closed') THEN status ELSE 'closed' END,
               actor = $4,
               origin = $5,
               idempotency_key = $6,
               updated_at = now(),
               version = GREATEST(version + 1, $7)
           WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [workspaceId, resourceId, deletedAt, actor, origin, idempotencyKey, version],
        );
      }
      return client.query(
        `INSERT INTO ${this.table("sync_tombstones")} (
          workspace_id, resource_type, resource_id, deleted_at, version,
          actor, origin, idempotency_key, metadata_json
        ) VALUES ($1, $2, $3, $4::timestamptz, $5, $6, $7, $8, $9::jsonb)
        ON CONFLICT (workspace_id, resource_type, resource_id) DO UPDATE SET
          deleted_at = EXCLUDED.deleted_at,
          version = GREATEST(${this.table("sync_tombstones")}.version, EXCLUDED.version),
          actor = EXCLUDED.actor,
          origin = EXCLUDED.origin,
          idempotency_key = EXCLUDED.idempotency_key,
          metadata_json = EXCLUDED.metadata_json
        RETURNING *`,
        [
          workspaceId,
          resourceType,
          resourceId,
          deletedAt,
          version,
          actor,
          origin,
          idempotencyKey,
          JSON.stringify(normalizeMetadata(input.metadata ?? {}, "tombstone metadata")),
        ],
      );
    });
    return tombstoneFromRow(firstRow(result, "sync tombstone"));
  }

  private async withWorkspaceTransaction<T>(workspaceId: string, action: (client: PostgresQueryClient) => Promise<T>): Promise<T> {
    const txClient = await this.transactionClient();
    try {
      await txClient.query("BEGIN");
      await txClient.query("SELECT set_config($1, $2, true)", [this.workspaceSetting, workspaceId]);
      const result = await action(txClient);
      await txClient.query("COMMIT");
      return result;
    } catch (error) {
      await rollbackQuietly(txClient);
      throw error;
    } finally {
      txClient.release?.();
    }
  }

  private async transactionClient(): Promise<PostgresTransactionClient> {
    return this.client.connect ? await this.client.connect() : this.client;
  }

  private table(tableName: string): string {
    return `${quoteIdent(this.schemaName)}.${quoteIdent(tableName)}`;
  }
}

export function createPostgresRuntime(options: PostgresRuntimeOptions = {}): PostgresRuntime {
  return new PostgresRuntime(options);
}

export function buildPostgresRuntimeReadiness(options: Pick<PostgresRuntimeOptions, "databaseUrl" | "schemaName" | "workspaceId" | "workspaceSetting"> & {
  schemaVerified?: boolean;
} = {}): PostgresRuntimeReadiness {
  const plan = buildPostgresMigrationPlan({
    databaseUrl: options.databaseUrl ?? process.env.HASNA_UPTIME_DATABASE_URL,
    schemaName: options.schemaName,
    workspaceSetting: options.workspaceSetting,
  });
  const workspaceId = normalizeOptionalWorkspaceId(options.workspaceId ?? process.env.HASNA_UPTIME_WORKSPACE_ID);
  const schemaVerified = options.schemaVerified === true;
  const migrationBlockers = plan.blockers.filter((blocker) => !blocker.startsWith("async-runtime-adapter:"));
  const checks = [
    {
      name: "postgres-url-configured",
      ok: plan.database.validPostgresUrl,
      detail: plan.database.redactedUrl ?? "<unset>",
    },
    {
      name: "postgres-tls",
      ok: !migrationBlockers.some((blocker) => blocker.startsWith("postgres-tls:")),
      detail: migrationBlockers.find((blocker) => blocker.startsWith("postgres-tls:")) ?? "ssl required",
    },
    {
      name: "postgres-runtime-schema-verified",
      ok: schemaVerified,
      detail: schemaVerified ? "caller supplied schema verification evidence" : "not verified in this process",
    },
    { name: "postgres-monitor-store", ok: true, detail: "workspace-scoped monitor upsert/tombstone methods are implemented" },
    { name: "postgres-probe-identity-store", ok: true, detail: "workspace-scoped probe identity methods include class and location" },
    { name: "postgres-check-jobs-leases", ok: true, detail: "deterministic check_jobs creation, due discovery, claim, fencing, and completion methods are implemented" },
    { name: "postgres-probe-submission-replay-guard", ok: true, detail: "nonce replay conflict detection uses payload_hash" },
    { name: "postgres-audit-tombstones", ok: true, detail: "audit_events and sync_tombstones writers are implemented" },
    { name: "uptime-service-integration", ok: false, detail: "UptimeService and hosted worker loops are not wired to this runtime yet" },
    { name: "cloud-worker-promotable", ok: false, detail: "worker alarms, deploy drain, sustained liveness, and live smokes are still required" },
  ];
  const blockers = [
    ...migrationBlockers,
    ...checks.filter((check) => !check.ok).map((check) => `${check.name}: ${check.detail}`),
  ];
  const coreBlockers = [
    ...migrationBlockers,
    ...checks
      .filter((check) => !check.ok && check.name !== "uptime-service-integration" && check.name !== "cloud-worker-promotable")
      .map((check) => `${check.name}: ${check.detail}`),
  ];
  return {
    kind: "open-uptime.postgres-runtime-readiness",
    version: POSTGRES_RUNTIME_VERSION,
    status: blockers.length === 0 ? "ready" : "blocked",
    canUseCoreRuntime: coreBlockers.length === 0,
    canPromoteHostedWorkers: false,
    schemaName: plan.schemaName,
    workspaceId,
    database: {
      configured: plan.database.configured,
      redactedUrl: plan.database.redactedUrl,
    },
    checks,
    blockers,
    capabilities: {
      monitorStore: true,
      probeIdentityStore: true,
      checkJobLeases: true,
      checkResultWriter: true,
      auditWriter: true,
      tombstoneWriter: true,
    },
  };
}

export function checkJobIdempotencyKey(input: {
  workspaceId: string;
  monitorId: string;
  monitorRevision: number;
  scheduleSlot: string;
  probePolicyHash: string;
}): string {
  return `sha256:${sha256(stableJson({
    version: "open-uptime.probe-job.v1",
    workspaceId: input.workspaceId,
    monitorId: input.monitorId,
    monitorRevision: input.monitorRevision,
    scheduleSlot: input.scheduleSlot,
    probePolicyHash: input.probePolicyHash,
  }))}`;
}

export function sanitizePostgresRuntimeError(error: unknown, databaseUrl?: string): string {
  let message = error instanceof Error ? error.message : String(error);
  if (databaseUrl) message = message.split(databaseUrl).join(redactPostgresUrl(databaseUrl));
  return message
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^@\s/:]+):([^@\s/]*)@/gi, (match, protocol: string, user: string, password: string) =>
      user === "user" && password === "redacted" ? match : `${protocol}[REDACTED]:[REDACTED]@`)
    .replace(/(password|passwd|pwd|token|access[_-]?token|secret|api[_-]?key|key|credential|signature|sig|jwt|code|session|auth|oauth)=([^&\s]+)/gi, "$1=redacted")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer redacted")
    .replace(/\b(?:esk|sk)_[A-Za-z0-9_-]{12,}\b/g, "key_redacted");
}

function monitorFromRow(row: Record<string, unknown>): PostgresMonitorRecord {
  return {
    workspaceId: stringField(row.workspace_id),
    id: stringField(row.id),
    name: stringField(row.name),
    kind: normalizeMonitorKind(stringField(row.kind)),
    url: nullableStringField(row.url),
    host: nullableStringField(row.host),
    port: nullableNumberField(row.port),
    method: stringField(row.method),
    expectedStatus: nullableNumberField(row.expected_status),
    intervalSeconds: numberField(row.interval_seconds),
    timeoutMs: numberField(row.timeout_ms),
    retryCount: numberField(row.retry_count),
    enabled: booleanField(row.enabled),
    status: normalizeMonitorStatus(stringField(row.status)),
    lastCheckedAt: nullableIsoFromField(row.last_checked_at),
    revision: numberField(row.version),
    actor: nullableStringField(row.actor),
    origin: nullableStringField(row.origin),
    idempotencyKey: nullableStringField(row.idempotency_key),
    createdAt: isoFromField(row.created_at),
    updatedAt: isoFromField(row.updated_at),
    deletedAt: nullableIsoFromField(row.deleted_at),
  };
}

function monitorSnapshotFromMonitor(row: PostgresMonitorRecord): PostgresMonitorSnapshot {
  return {
    workspaceId: row.workspaceId,
    id: row.id,
    name: row.name,
    kind: row.kind,
    url: row.url,
    host: row.host,
    port: row.port,
    method: row.method,
    expectedStatus: row.expectedStatus,
    intervalSeconds: row.intervalSeconds,
    timeoutMs: row.timeoutMs,
    retryCount: row.retryCount,
    enabled: row.enabled,
    status: row.status,
    lastCheckedAt: row.lastCheckedAt,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function probeIdentityFromRow(row: Record<string, unknown>): PostgresProbeIdentityRecord {
  return {
    workspaceId: stringField(row.workspace_id),
    id: stringField(row.id),
    name: stringField(row.name),
    probeClass: normalizeProbeClass(stringField(row.probe_class)),
    probeLocation: normalizeProbeLocation(stringField(row.probe_location ?? "default")),
    machineId: nullableStringField(row.machine_id),
    publicKeyPem: stringField(row.public_key_pem),
    publicKeyFingerprint: stringField(row.public_key_fingerprint),
    enabled: booleanField(row.enabled),
    capabilities: parseJsonObject(row.capabilities),
    lastSeenAt: nullableIsoFromField(row.last_seen_at),
    version: numberField(row.version),
  };
}

function checkJobFromRow(row: Record<string, unknown>): PostgresCheckJobRecord {
  return {
    workspaceId: stringField(row.workspace_id),
    id: stringField(row.id),
    monitorId: stringField(row.monitor_id),
    monitorRevision: numberField(row.monitor_version),
    monitorSnapshot: monitorSnapshotFromJson(row.monitor_snapshot),
    scheduleSlot: isoFromField(row.schedule_slot),
    probePolicy: normalizeProbePolicy(parseJsonObject(row.probe_policy) as unknown as ProbePolicy),
    probePolicyHash: stringField(row.probe_policy_hash),
    status: normalizeCheckJobStatus(stringField(row.status)),
    claimedByProbeId: nullableStringField(row.claimed_by_probe_id),
    fencingToken: nullableStringField(row.fencing_token),
    dueAt: isoFromField(row.due_at),
    claimedAt: nullableIsoFromField(row.claimed_at),
    leaseExpiresAt: nullableIsoFromField(row.lease_expires_at),
    submittedResultId: nullableStringField(row.submitted_result_id),
    deployGeneration: numberField(row.deploy_generation),
    version: numberField(row.version),
    createdAt: isoFromField(row.created_at),
    updatedAt: isoFromField(row.updated_at),
  };
}

function monitorSnapshotFromJson(value: unknown): PostgresMonitorSnapshot {
  const raw = parseJsonObject(value);
  return {
    workspaceId: normalizeWorkspaceId(stringField(raw.workspaceId)),
    id: normalizeId(stringField(raw.id)),
    name: normalizeName(stringField(raw.name), "monitor snapshot name"),
    kind: normalizeMonitorKind(stringField(raw.kind)),
    url: normalizeNullableMonitorUrl(nullableStringField(raw.url)),
    host: normalizeNullableHost(nullableStringField(raw.host)),
    port: normalizeNullablePort(nullableNumberField(raw.port)),
    method: normalizeMethod(stringField(raw.method)),
    expectedStatus: normalizeNullableExpectedStatus(nullableNumberField(raw.expectedStatus)),
    intervalSeconds: normalizePositiveInteger(numberField(raw.intervalSeconds), "monitor snapshot intervalSeconds"),
    timeoutMs: normalizePositiveInteger(numberField(raw.timeoutMs), "monitor snapshot timeoutMs"),
    retryCount: normalizeNonNegativeInteger(numberField(raw.retryCount), "monitor snapshot retryCount"),
    enabled: booleanField(raw.enabled),
    status: normalizeMonitorStatus(stringField(raw.status)),
    lastCheckedAt: normalizeNullableIsoTimestamp(nullableStringField(raw.lastCheckedAt), "monitor snapshot lastCheckedAt"),
    revision: normalizePositiveInteger(numberField(raw.revision), "monitor snapshot revision"),
    createdAt: normalizeIsoTimestamp(stringField(raw.createdAt), "monitor snapshot createdAt"),
    updatedAt: normalizeIsoTimestamp(stringField(raw.updatedAt), "monitor snapshot updatedAt"),
  };
}

function checkResultFromRow(row: Record<string, unknown>): PostgresCheckResultRecord {
  return {
    workspaceId: stringField(row.workspace_id),
    id: stringField(row.id),
    monitorId: stringField(row.monitor_id),
    jobId: nullableStringField(row.job_id),
    probeId: nullableStringField(row.probe_id),
    monitorRevision: numberField(row.monitor_version),
    scheduleSlot: isoFromField(row.schedule_slot),
    probeClass: normalizeProbeClass(stringField(row.probe_class)),
    probeLocation: normalizeProbeLocation(stringField(row.probe_location)),
    probePolicyHash: stringField(row.probe_policy_hash),
    checkedAt: isoFromField(row.checked_at),
    status: normalizeCheckStatus(stringField(row.status)),
    latencyMs: nullableNumberField(row.latency_ms),
    statusCode: nullableNumberField(row.status_code),
    error: nullableStringField(row.error),
    attemptCount: numberField(row.attempt_count),
    evidence: row.evidence_json == null ? null : parseJsonObject(row.evidence_json) as unknown as CheckEvidence,
    actor: nullableStringField(row.actor),
    origin: nullableStringField(row.origin),
    idempotencyKey: nullableStringField(row.idempotency_key),
  };
}

function probeSubmissionFromRow(row: Record<string, unknown>): PostgresProbeSubmissionRecord {
  return {
    workspaceId: stringField(row.workspace_id),
    id: stringField(row.id),
    probeId: stringField(row.probe_id),
    jobId: stringField(row.job_id),
    monitorId: stringField(row.monitor_id),
    monitorRevision: numberField(row.monitor_revision),
    scheduleSlot: isoFromField(row.schedule_slot),
    probeClass: normalizeProbeClass(stringField(row.probe_class)),
    probeLocation: normalizeProbeLocation(stringField(row.probe_location)),
    probePolicyHash: stringField(row.probe_policy_hash),
    payloadHash: stringField(row.payload_hash),
    checkResultId: stringField(row.check_result_id),
    nonce: stringField(row.nonce),
    checkedAt: isoFromField(row.checked_at),
    submittedAt: isoFromField(row.submitted_at),
  };
}

function auditEventFromRow(row: Record<string, unknown>): PostgresAuditEventRecord {
  return {
    workspaceId: stringField(row.workspace_id),
    id: stringField(row.id),
    action: stringField(row.action),
    resourceType: nullableStringField(row.resource_type),
    resourceId: nullableStringField(row.resource_id),
    message: nullableStringField(row.message),
    metadata: parseJsonObject(row.metadata_json),
    actor: nullableStringField(row.actor),
    origin: nullableStringField(row.origin),
    idempotencyKey: nullableStringField(row.idempotency_key),
    createdAt: isoFromField(row.created_at),
  };
}

function tombstoneFromRow(row: Record<string, unknown>): PostgresSyncTombstoneRecord {
  return {
    workspaceId: stringField(row.workspace_id),
    resourceType: stringField(row.resource_type),
    resourceId: stringField(row.resource_id),
    deletedAt: isoFromField(row.deleted_at),
    version: numberField(row.version),
    actor: nullableStringField(row.actor),
    origin: nullableStringField(row.origin),
    idempotencyKey: nullableStringField(row.idempotency_key),
    metadata: parseJsonObject(row.metadata_json),
  };
}

function redactCheckJobForDiscovery(job: PostgresCheckJobRecord): PostgresCheckJobRecord {
  return { ...job, fencingToken: null };
}

function normalizeMonitorKind(value: string): MonitorKind {
  if (value === "http" || value === "tcp" || value === "browser_page") return value;
  throw new Error("monitor kind must be http, tcp, or browser_page");
}

function normalizeMonitorStatus(value: string): MonitorStatus {
  if (value === "unknown" || value === "up" || value === "down" || value === "paused") return value;
  throw new Error("monitor status must be unknown, up, down, or paused");
}

function normalizeCheckStatus(value: string): CheckStatus {
  if (value === "up" || value === "down") return value;
  throw new Error("check status must be up or down");
}

function normalizeCheckJobStatus(value: string): ProbeCheckJobStatus {
  if (value === "pending" || value === "claimed" || value === "submitted" || value === "expired" || value === "cancelled") return value;
  throw new Error("check job status is invalid");
}

function normalizeProbeClass(value: string): ProbeClass {
  if (value === "public" || value === "private") return value;
  throw new Error("probe class must be public or private");
}

function normalizeProbePolicy(input: ProbePolicy | undefined): ProbePolicy {
  const probeClass = normalizeProbeClass(input?.probeClass ?? "private");
  const locations = Array.from(new Set((input?.locations ?? []).map((location) => normalizeProbeLocation(location))))
    .sort((left, right) => left.localeCompare(right));
  return { probeClass, locations };
}

function normalizeProbeLocation(value: string): string {
  return normalizeOpaqueText(value, "probe location", 120);
}

function hashProbePolicy(policy: ProbePolicy): string {
  return sha256(stableJson(policy));
}

function deterministicProbeJobId(input: {
  workspaceId: string;
  monitorId: string;
  monitorRevision: number;
  scheduleSlot: string;
  probePolicyHash: string;
}): string {
  return `job_${checkJobIdempotencyKey(input).replace("sha256:", "").slice(0, 32)}`;
}

function normalizeSchemaName(value: string): string {
  const normalized = value.trim();
  if (!/^[a-z_][a-z0-9_]*$/.test(normalized)) throw new Error("Postgres schema name is invalid");
  return normalized;
}

function normalizeWorkspaceSetting(value: string): string {
  const normalized = value.trim();
  if (!/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)+$/.test(normalized)) {
    throw new Error("workspace setting must be a dotted lowercase setting such as app.workspace_id");
  }
  return normalized;
}

function normalizeOptionalWorkspaceId(value: string | undefined | null): string | null {
  if (value == null || value.trim() === "") return null;
  return normalizeWorkspaceId(value);
}

function normalizeWorkspaceId(value: string): string {
  return normalizeOpaqueText(value, "workspace id", 128);
}

function normalizeId(value: string): string {
  return normalizeOpaqueText(value, "id", 160);
}

function normalizeName(value: string, label: string): string {
  return normalizeOpaqueText(value, label, 200);
}

function normalizeMethod(value: string): string {
  const normalized = normalizeOpaqueText(value, "HTTP method", 16).toUpperCase();
  if (!/^[A-Z][A-Z0-9_-]{0,15}$/.test(normalized)) throw new Error("HTTP method is invalid");
  return normalized;
}

function normalizeNullableMonitorUrl(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  const normalized = normalizeOpaqueText(value, "monitor URL", 2000);
  const url = new URL(normalized);
  if (url.username || url.password) throw new Error("monitor URL must not include credentials");
  for (const key of url.searchParams.keys()) {
    if (SECRET_KEY_PATTERN.test(key)) throw new Error("monitor URL must not include secret query parameters");
  }
  return normalized;
}

function normalizeNullableHost(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  const normalized = normalizeOpaqueText(value, "monitor host", 253);
  if (/[:/@?#]/.test(normalized)) throw new Error("monitor host must not include URL syntax");
  return normalized;
}

function normalizeNullablePort(value: number | null | undefined): number | null {
  if (value == null) return null;
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error("monitor port must be 1-65535");
  return value;
}

function normalizeNullableExpectedStatus(value: number | null | undefined): number | null {
  if (value == null) return null;
  if (!Number.isInteger(value) || value < 100 || value > 599) throw new Error("HTTP status must be 100-599");
  return value;
}

function normalizeNullableNonNegativeNumber(value: number | null | undefined, label: string): number | null {
  if (value == null) return null;
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be non-negative`);
  return value;
}

function normalizePositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}

function normalizeNonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  return value;
}

function normalizeIsoTimestamp(value: string, label: string): string {
  const normalized = normalizeOpaqueText(value, label, 80);
  const time = Date.parse(normalized);
  if (!Number.isFinite(time)) throw new Error(`${label} must be an ISO timestamp`);
  return new Date(time).toISOString();
}

function normalizeNullableIsoTimestamp(value: string | null | undefined, label: string): string | null {
  if (value == null || value === "") return null;
  return normalizeIsoTimestamp(value, label);
}

function normalizeNonce(value: string): string {
  return normalizeOpaqueText(value, "probe nonce", 160);
}

function normalizeSha256(value: string, label: string): string {
  const normalized = normalizeOpaqueText(value, label, 128).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`${label} must be a SHA-256 hex digest`);
  return normalized;
}

function normalizePublicKeyPem(value: string): string {
  const normalized = value.trim();
  if (!normalized.includes("BEGIN PUBLIC KEY") || normalized.includes("PRIVATE KEY")) {
    throw new Error("probe public key must be a public key PEM");
  }
  if (normalized.length > 5000) throw new Error("probe public key must be 5000 characters or less");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) {
    throw new Error("probe public key must not include control characters");
  }
  return normalized;
}

function normalizeMetadata(value: Record<string, unknown>, label: string): Record<string, unknown> {
  assertNoSecretKeys(value, label);
  return value;
}

function normalizeEvidence(value: CheckEvidence): CheckEvidence {
  if ((value as { redacted?: unknown }).redacted !== true) throw new Error("check evidence must be redacted before Postgres storage");
  assertNoSecretKeys(value as unknown as Record<string, unknown>, "check evidence");
  return value;
}

function normalizeResourceType(value: TombstonePostgresResourceInput["resourceType"]): string {
  return normalizeOpaqueText(value, "resource type", 80);
}

function normalizeNullableOpaqueText(value: string | null | undefined, label: string, maxLength: number): string | null {
  if (value == null || value === "") return null;
  return normalizeOpaqueText(value, label, maxLength);
}

function normalizeNullableRedactedText(value: string | null | undefined, label: string, maxLength: number): string | null {
  if (value == null || value === "") return null;
  const normalized = normalizeOpaqueText(value, label, maxLength);
  if (SECRET_VALUE_PATTERN.test(normalized)) throw new Error(`${label} must be redacted`);
  return normalized;
}

function normalizeOpaqueText(value: string, label: string, maxLength = 160): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  if (normalized.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or less`);
  if (/[\u0000-\u001f\u007f]/.test(normalized)) throw new Error(`${label} must not include control characters`);
  if (SECRET_KEY_PATTERN.test(label) && SECRET_VALUE_PATTERN.test(normalized)) throw new Error(`${label} must not contain secret material`);
  return normalized;
}

function deterministicId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${sha256(parts.join("\u001f")).slice(0, 32)}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
}

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function firstRow(result: { rows: unknown[] }, label: string): Record<string, unknown> {
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error(`${label} write returned no row`);
  return row;
}

async function rollbackQuietly(client: PostgresQueryClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original transaction error.
  }
}

function stringField(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

function nullableStringField(value: unknown): string | null {
  return value == null ? null : String(value);
}

function numberField(value: unknown): number {
  return Number(value);
}

function nullableNumberField(value: unknown): number | null {
  return value == null ? null : Number(value);
}

function booleanField(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return String(value) === "true" || String(value) === "1";
}

function isoFromField(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return normalizeIsoTimestamp(String(value), "timestamp");
}

function nullableIsoFromField(value: unknown): string | null {
  if (value == null) return null;
  return isoFromField(value);
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value === "object") return value as Record<string, unknown>;
  const parsed = JSON.parse(String(value)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

function assertNoSecretKeys(value: Record<string, unknown>, label: string): void {
  const stack: Array<{ value: unknown; path: string }> = [{ value, path: label }];
  while (stack.length) {
    const current = stack.pop()!;
    if (!current.value || typeof current.value !== "object") continue;
    for (const [key, nested] of Object.entries(current.value as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(key)) throw new Error(`${current.path}.${key} must not contain secret material`);
      if (typeof nested === "string" && SECRET_VALUE_PATTERN.test(nested)) {
        throw new Error(`${current.path}.${key} must be redacted`);
      }
      stack.push({ value: nested, path: `${current.path}.${key}` });
    }
  }
}

function clampLimit(value: number): number {
  if (!Number.isInteger(value) || value < 1) throw new Error("limit must be a positive integer");
  return Math.min(value, 500);
}

const SECRET_KEY_PATTERN = /(password|passwd|pwd|token|access[_-]?token|secret|api[_-]?key|credential|signature|sig|jwt|code|session|auth|oauth)/i;
const SECRET_VALUE_PATTERN = /\b(?:Bearer\s+)?(?:esk|sk)_[A-Za-z0-9_-]{12,}\b|password=|token=|secret=|api[_-]?key=/i;

type PostgresRuntimeClient = PostgresQueryClient & { connect?: () => Promise<PostgresTransactionClient> };
type PostgresTransactionClient = PostgresQueryClient & { release?: () => void };
