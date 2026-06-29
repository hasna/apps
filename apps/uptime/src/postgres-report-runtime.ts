import { createHash, randomUUID } from "node:crypto";
import { createPostgresPool, type PostgresQueryClient } from "./postgres.js";
import { buildPostgresMigrationPlan, redactPostgresUrl } from "./postgres-plan.js";
import type { ReportDeliveryChannel, ReportDeliveryRecord } from "./types.js";

export const POSTGRES_REPORT_RUNTIME_VERSION = 1;

export type PostgresReportRunStatus = "pending" | "running" | "succeeded" | "failed" | "retry_exhausted";
export type PostgresReportRunInputStatus = PostgresReportRunStatus | "success";
export type PostgresReportDeliveryAttemptStatus = "pending" | "sending" | "succeeded" | "failed" | "retry_exhausted";
export type PostgresReportArtifactType = "json" | "html" | "pdf" | "summary";
export type PostgresReportArtifactRetentionClass = "standard" | "compliance" | "legal_hold";

export interface PostgresReportRuntimeOptions {
  databaseUrl?: string;
  schemaName?: string;
  workspaceId?: string;
  workspaceSetting?: string;
  client?: PostgresQueryClient;
  now?: () => Date;
}

export interface PostgresReportRuntimeReadiness {
  kind: "open-uptime.postgres-report-runtime-readiness";
  version: number;
  status: "ready" | "blocked";
  canWriteReportMetadata: boolean;
  schemaName: string;
  workspaceId: string | null;
  database: {
    configured: boolean;
    redactedUrl: string | null;
  };
  checks: Array<{ name: string; ok: boolean; detail: string }>;
  blockers: string[];
  capabilities: {
    reportRunWriter: boolean;
    scheduleClaiming: boolean;
    reportRunStateMachine: boolean;
    deliveryAttemptState: boolean;
    deliveryIdempotency: boolean;
    retryBackoffMetadata: boolean;
    artifactMetadataWriter: boolean;
    artifactObjectWriter: boolean;
    auditExport: boolean;
    deliveryAlarms: boolean;
  };
}

export interface RecordPostgresReportRunInput {
  id?: string;
  workspaceId?: string;
  scheduleId?: string | null;
  status: PostgresReportRunInputStatus;
  startedAt?: string;
  finishedAt?: string | null;
  deliveries?: ReportDeliveryRecord[];
  error?: string | null;
  reportJson?: Record<string, unknown> | null;
  artifactRef?: string | null;
  actor?: string | null;
  origin?: string | null;
  idempotencyKey?: string | null;
}

export interface PostgresReportRunRecord {
  workspaceId: string;
  id: string;
  scheduleId: string | null;
  status: PostgresReportRunStatus;
  startedAt: string;
  finishedAt: string | null;
  deliveries: ReportDeliveryRecord[];
  error: string | null;
  reportJson: Record<string, unknown> | null;
  artifactRef: string | null;
  actor: string | null;
  origin: string | null;
  idempotencyKey: string | null;
  claimedByWorkerId: string | null;
  fencingToken: string | null;
  leaseExpiresAt: string | null;
  version: number;
}

export interface ClaimPostgresReportRunInput {
  workspaceId?: string;
  id: string;
  workerId: string;
  leaseTtlMs?: number;
}

export interface CompletePostgresReportRunInput {
  workspaceId?: string;
  id: string;
  workerId: string;
  fencingToken: string;
  status: Extract<PostgresReportRunStatus, "succeeded" | "failed" | "retry_exhausted">;
  finishedAt?: string;
  deliveries?: ReportDeliveryRecord[];
  error?: string | null;
  reportJson?: Record<string, unknown> | null;
  artifactRef?: string | null;
}

export interface BeginPostgresReportRunForScheduleClaimInput {
  workspaceId?: string;
  scheduleId: string;
  workerId: string;
  scheduleFencingToken: string;
  leaseTtlMs?: number;
  actor?: string | null;
  origin?: string | null;
}

export interface FinishPostgresReportRunForScheduleClaimInput {
  workspaceId?: string;
  scheduleId: string;
  reportRunId?: string;
  workerId: string;
  scheduleFencingToken: string;
  reportRunFencingToken: string;
  status: Extract<PostgresReportRunStatus, "succeeded" | "failed" | "retry_exhausted">;
  finishedAt?: string;
  deliveries?: ReportDeliveryRecord[];
  error?: string | null;
  reportJson?: Record<string, unknown> | null;
  artifactRef?: string | null;
}

export interface FinishPostgresReportRunForScheduleClaimResult {
  reportRun: PostgresReportRunRecord;
  schedule: PostgresReportScheduleClaimRecord;
}

export interface ListDuePostgresReportSchedulesOptions {
  workspaceId?: string;
  now?: string;
  limit?: number;
}

export interface ClaimPostgresReportScheduleInput {
  workspaceId?: string;
  id: string;
  workerId: string;
  now?: string;
  leaseTtlMs?: number;
}

export interface CompletePostgresReportScheduleClaimInput {
  workspaceId?: string;
  id: string;
  workerId: string;
  fencingToken: string;
  finishedAt?: string;
}

export interface PostgresReportScheduleChannelSummary {
  email: boolean;
  sms: boolean;
  logs: boolean;
}

export interface PostgresReportScheduleClaimRecord {
  workspaceId: string;
  id: string;
  name: string;
  enabled: boolean;
  intervalSeconds: number;
  nextRunAt: string;
  lastRunAt: string | null;
  subject: string | null;
  channels: PostgresReportScheduleChannelSummary;
  claimedByWorkerId: string | null;
  fencingToken: string | null;
  leaseExpiresAt: string | null;
  version: number;
}

export interface CreatePostgresReportDeliveryAttemptInput {
  id?: string;
  workspaceId?: string;
  reportRunId: string;
  channel: ReportDeliveryChannel;
  channelRefId: string;
  provider: string;
  attemptNumber?: number;
  status?: PostgresReportDeliveryAttemptStatus;
  idempotencyKey?: string;
  scheduledAt?: string;
  nextRetryAt?: string | null;
  responseStatus?: number | null;
  providerMessageId?: string | null;
  error?: string | null;
  retryAfterSeconds?: number | null;
  requestHash?: string | null;
  responseHash?: string | null;
  actor?: string | null;
  origin?: string | null;
}

export interface ClaimPostgresReportDeliveryAttemptInput {
  workspaceId?: string;
  id: string;
  workerId: string;
  leaseTtlMs?: number;
}

export interface CompletePostgresReportDeliveryAttemptInput {
  workspaceId?: string;
  id: string;
  status: Extract<PostgresReportDeliveryAttemptStatus, "succeeded" | "failed" | "retry_exhausted">;
  fencingToken: string;
  finishedAt?: string;
  nextRetryAt?: string | null;
  responseStatus?: number | null;
  providerMessageId?: string | null;
  error?: string | null;
  retryAfterSeconds?: number | null;
  responseHash?: string | null;
}

export interface ListDuePostgresReportDeliveryAttemptsOptions {
  workspaceId?: string;
  now?: string;
  limit?: number;
}

export interface PostgresReportDeliveryAttemptRecord {
  workspaceId: string;
  id: string;
  reportRunId: string;
  channel: ReportDeliveryChannel;
  channelRefId: string;
  provider: string;
  attemptNumber: number;
  status: PostgresReportDeliveryAttemptStatus;
  idempotencyKey: string;
  scheduledAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  nextRetryAt: string | null;
  responseStatus: number | null;
  providerMessageId: string | null;
  error: string | null;
  retryAfterSeconds: number | null;
  requestHash: string | null;
  responseHash: string | null;
  claimedByWorkerId: string | null;
  fencingToken: string | null;
  leaseExpiresAt: string | null;
  version: number;
}

export interface RecordPostgresReportArtifactInput {
  id?: string;
  workspaceId?: string;
  reportRunId: string;
  artifactType: PostgresReportArtifactType;
  storageRef: string;
  sha256: string;
  byteSize: number;
  redacted?: boolean;
  retentionClass?: PostgresReportArtifactRetentionClass;
  kmsKeyRef?: string | null;
  actor?: string | null;
  origin?: string | null;
  idempotencyKey?: string | null;
}

export interface PostgresReportArtifactRecord {
  workspaceId: string;
  id: string;
  reportRunId: string;
  artifactType: PostgresReportArtifactType;
  storageRef: string;
  sha256: string;
  byteSize: number;
  redacted: boolean;
  retentionClass: PostgresReportArtifactRetentionClass;
  kmsKeyRef: string | null;
  actor: string | null;
  origin: string | null;
  idempotencyKey: string | null;
}

export class PostgresReportRuntime {
  private readonly client: PostgresReportRuntimeClient;
  private readonly ownedClient: PostgresReportRuntimeClient | null;
  private readonly schemaName: string;
  private readonly workspaceId: string;
  private readonly workspaceSetting: string;
  private readonly clock: () => Date;

  constructor(options: PostgresReportRuntimeOptions = {}) {
    this.schemaName = normalizeSchemaName(options.schemaName ?? "uptime");
    const resolvedWorkspaceId = options.workspaceId ?? process.env.HASNA_UPTIME_WORKSPACE_ID;
    if ((process.env.HASNA_UPTIME_MODE ?? "").trim() === "hosted" && !resolvedWorkspaceId) {
      throw new Error("Postgres report runtime requires HASNA_UPTIME_WORKSPACE_ID or workspaceId in hosted mode");
    }
    this.workspaceId = normalizeWorkspaceId(resolvedWorkspaceId ?? "default");
    this.workspaceSetting = normalizeWorkspaceSetting(options.workspaceSetting ?? "app.workspace_id");
    this.clock = options.now ?? (() => new Date());
    if (options.client) {
      this.client = options.client;
      this.ownedClient = null;
    } else {
      const databaseUrl = options.databaseUrl ?? process.env.HASNA_UPTIME_DATABASE_URL;
      if (!databaseUrl) throw new Error("HASNA_UPTIME_DATABASE_URL is required for Postgres report runtime");
      const plan = buildPostgresMigrationPlan({
        databaseUrl,
        schemaName: this.schemaName,
        workspaceSetting: this.workspaceSetting,
      });
      if (!plan.database.validPostgresUrl || !plan.database.tlsRequired) {
        throw new Error("Postgres report runtime requires a postgres:// or postgresql:// URL with sslmode=require, sslmode=verify-full, or ssl=true");
      }
      this.client = createPostgresPool(databaseUrl) as PostgresReportRuntimeClient;
      this.ownedClient = this.client;
    }
  }

  async close(): Promise<void> {
    await this.ownedClient?.end?.();
  }

  async recordReportRun(input: RecordPostgresReportRunInput): Promise<PostgresReportRunRecord> {
    const workspaceId = normalizeWorkspaceId(input.workspaceId ?? this.workspaceId);
    const startedAt = normalizeIsoTimestamp(input.startedAt ?? this.clock().toISOString(), "report run startedAt");
    const idempotencyKey = input.idempotencyKey == null ? null : normalizeOpaqueText(input.idempotencyKey, "report run idempotency key", 256);
    const id = normalizeId(input.id ?? deterministicId("rpr", workspaceId, idempotencyKey ?? randomUUID()));
    const scheduleId = normalizeNullableOpaqueText(input.scheduleId, "report schedule id", 160);
    const status = normalizeReportRunStatus(input.status);
    const finishedAt = input.finishedAt == null
      ? (isTerminalReportRunStatus(status) ? this.clock().toISOString() : null)
      : normalizeIsoTimestamp(input.finishedAt, "report run finishedAt");
    const deliveries = normalizeDeliveries(input.deliveries ?? []);
    const error = normalizeNullableRedactedText(input.error, "report run error", 1000);
    const reportJson = normalizeReportJsonMetadata(input.reportJson);
    const artifactRef = normalizeNullableArtifactRef(input.artifactRef, "report run artifact ref");
    const result = await this.withWorkspaceTransaction(workspaceId, (client) => client.query(
      `INSERT INTO ${this.table("report_runs")} (
        workspace_id, id, schedule_id, status, started_at, finished_at,
        deliveries_json, error, report_json, artifact_ref, actor, origin, idempotency_key
      ) VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7::jsonb, $8, $9::jsonb, $10, $11, $12, $13)
      ON CONFLICT (workspace_id, id) DO UPDATE SET
        idempotency_key = ${this.table("report_runs")}.idempotency_key
      WHERE ${this.table("report_runs")}.idempotency_key IS NOT DISTINCT FROM EXCLUDED.idempotency_key
        AND ${this.table("report_runs")}.schedule_id IS NOT DISTINCT FROM EXCLUDED.schedule_id
        AND ${this.table("report_runs")}.status IS NOT DISTINCT FROM EXCLUDED.status
        AND ${this.table("report_runs")}.deliveries_json IS NOT DISTINCT FROM EXCLUDED.deliveries_json
        AND ${this.table("report_runs")}.error IS NOT DISTINCT FROM EXCLUDED.error
        AND ${this.table("report_runs")}.report_json IS NOT DISTINCT FROM EXCLUDED.report_json
        AND ${this.table("report_runs")}.artifact_ref IS NOT DISTINCT FROM EXCLUDED.artifact_ref
      RETURNING *`,
      [
        workspaceId,
        id,
        scheduleId,
        status,
        startedAt,
        finishedAt,
        JSON.stringify(deliveries),
        error,
        reportJson ? JSON.stringify(reportJson) : null,
        artifactRef,
        normalizeNullableOpaqueText(input.actor, "report run actor", 160),
        normalizeNullableOpaqueText(input.origin, "report run origin", 160),
        idempotencyKey,
      ],
    ));
    const row = result.rows[0];
    if (!row) throw new Error("report run idempotency conflict");
    return reportRunFromRow(row as Record<string, unknown>);
  }

  async claimReportRun(input: ClaimPostgresReportRunInput): Promise<PostgresReportRunRecord | null> {
    const workspaceId = normalizeWorkspaceId(input.workspaceId ?? this.workspaceId);
    const id = normalizeId(input.id);
    const workerId = normalizeOpaqueText(input.workerId, "worker id", 160);
    const leaseTtlMs = normalizePositiveInteger(input.leaseTtlMs ?? 300_000, "leaseTtlMs");
    const fencingToken = `rrf_${randomUUID().replace(/-/g, "")}`;
    const result = await this.withWorkspaceTransaction(workspaceId, (client) => client.query(
      `UPDATE ${this.table("report_runs")}
       SET status = 'running',
           claimed_by_worker_id = $3,
           fencing_token = $4,
           lease_expires_at = now() + ($5::bigint * interval '1 millisecond'),
           updated_at = now(),
           version = version + 1
       WHERE workspace_id = $1
         AND id = $2
         AND deleted_at IS NULL
         AND (
           status = 'pending'
           OR (status = 'running' AND lease_expires_at <= now())
         )
       RETURNING *`,
      [workspaceId, id, workerId, fencingToken, leaseTtlMs],
    ));
    const row = result.rows[0];
    return row ? reportRunFromRow(row as Record<string, unknown>) : null;
  }

  async completeReportRun(input: CompletePostgresReportRunInput): Promise<PostgresReportRunRecord | null> {
    const workspaceId = normalizeWorkspaceId(input.workspaceId ?? this.workspaceId);
    const id = normalizeId(input.id);
    const workerId = normalizeOpaqueText(input.workerId, "worker id", 160);
    const fencingToken = normalizeOpaqueText(input.fencingToken, "fencing token", 160);
    const status = normalizeTerminalReportRunStatus(input.status);
    const finishedAt = normalizeIsoTimestamp(input.finishedAt ?? this.clock().toISOString(), "report run finishedAt");
    const deliveries = normalizeDeliveries(input.deliveries ?? []);
    const error = normalizeNullableRedactedText(input.error, "report run error", 1000);
    const reportJson = normalizeReportJsonMetadata(input.reportJson);
    const artifactRef = normalizeNullableArtifactRef(input.artifactRef, "report run artifact ref");
    const result = await this.withWorkspaceTransaction(workspaceId, (client) => client.query(
      `UPDATE ${this.table("report_runs")}
       SET status = $3,
           finished_at = $4::timestamptz,
           deliveries_json = $5::jsonb,
           error = $6,
           report_json = $7::jsonb,
           artifact_ref = $8,
           claimed_by_worker_id = NULL,
           fencing_token = NULL,
           lease_expires_at = NULL,
           updated_at = now(),
           version = version + 1
       WHERE workspace_id = $1
         AND id = $2
         AND deleted_at IS NULL
         AND status = 'running'
         AND claimed_by_worker_id = $9
         AND fencing_token = $10
         AND lease_expires_at > now()
       RETURNING *`,
      [
        workspaceId,
        id,
        status,
        finishedAt,
        JSON.stringify(deliveries),
        error,
        reportJson ? JSON.stringify(reportJson) : null,
        artifactRef,
        workerId,
        fencingToken,
      ],
    ));
    const row = result.rows[0];
    return row ? reportRunFromRow(row as Record<string, unknown>) : null;
  }

  async beginReportRunForScheduleClaim(input: BeginPostgresReportRunForScheduleClaimInput): Promise<PostgresReportRunRecord | null> {
    const workspaceId = normalizeWorkspaceId(input.workspaceId ?? this.workspaceId);
    const scheduleId = normalizeId(input.scheduleId);
    const workerId = normalizeOpaqueText(input.workerId, "worker id", 160);
    const scheduleFencingToken = normalizeOpaqueText(input.scheduleFencingToken, "schedule fencing token", 160);
    const leaseTtlMs = normalizePositiveInteger(input.leaseTtlMs ?? 300_000, "leaseTtlMs");
    const reportRunFencingToken = `rrf_${randomUUID().replace(/-/g, "")}`;
    return await this.withWorkspaceTransaction(workspaceId, async (client) => {
      const scheduleResult = await client.query(
        `SELECT * FROM ${this.table("report_schedules")}
         WHERE workspace_id = $1
           AND id = $2
           AND enabled = true
           AND deleted_at IS NULL
           AND claimed_by_worker_id = $3
           AND fencing_token = $4
           AND lease_expires_at > now()
         FOR UPDATE`,
        [workspaceId, scheduleId, workerId, scheduleFencingToken],
      );
      const scheduleRow = scheduleResult.rows[0];
      if (!scheduleRow || typeof scheduleRow !== "object") return null;
      const scheduleWindow = isoStringField(scheduleRow as Record<string, unknown>, "next_run_at");
      const runId = reportRunIdForScheduleWindow(workspaceId, scheduleId, scheduleWindow);
      const idempotencyKey = reportRunScheduleWindowIdempotencyKey(workspaceId, scheduleId, scheduleWindow);
      const result = await client.query(
        `INSERT INTO ${this.table("report_runs")} (
          workspace_id, id, schedule_id, status, started_at, finished_at,
          deliveries_json, error, report_json, artifact_ref, actor, origin, idempotency_key,
          claimed_by_worker_id, fencing_token, lease_expires_at
        ) VALUES (
          $1, $2, $3, 'running', $4::timestamptz, NULL,
          '[]'::jsonb, NULL, NULL, NULL, $5, $6, $7,
          $8, $9, now() + ($10::bigint * interval '1 millisecond')
        )
        ON CONFLICT (workspace_id, id) DO UPDATE SET
          status = 'running',
          claimed_by_worker_id = EXCLUDED.claimed_by_worker_id,
          fencing_token = EXCLUDED.fencing_token,
          lease_expires_at = EXCLUDED.lease_expires_at,
          updated_at = now(),
          version = ${this.table("report_runs")}.version + 1
        WHERE ${this.table("report_runs")}.schedule_id IS NOT DISTINCT FROM EXCLUDED.schedule_id
          AND ${this.table("report_runs")}.started_at IS NOT DISTINCT FROM EXCLUDED.started_at
          AND ${this.table("report_runs")}.idempotency_key IS NOT DISTINCT FROM EXCLUDED.idempotency_key
          AND ${this.table("report_runs")}.status IN ('pending', 'running')
          AND (
            ${this.table("report_runs")}.fencing_token IS NULL
            OR ${this.table("report_runs")}.lease_expires_at <= now()
            OR ${this.table("report_runs")}.claimed_by_worker_id = EXCLUDED.claimed_by_worker_id
          )
        RETURNING *`,
        [
          workspaceId,
          runId,
          scheduleId,
          scheduleWindow,
          normalizeNullableOpaqueText(input.actor, "report run actor", 160),
          normalizeNullableOpaqueText(input.origin, "report run origin", 160),
          idempotencyKey,
          workerId,
          reportRunFencingToken,
          leaseTtlMs,
        ],
      );
      const row = result.rows[0];
      return row && typeof row === "object" ? reportRunFromRow(row as Record<string, unknown>) : null;
    });
  }

  async finishReportRunForScheduleClaim(input: FinishPostgresReportRunForScheduleClaimInput): Promise<FinishPostgresReportRunForScheduleClaimResult | null> {
    const workspaceId = normalizeWorkspaceId(input.workspaceId ?? this.workspaceId);
    const scheduleId = normalizeId(input.scheduleId);
    const workerId = normalizeOpaqueText(input.workerId, "worker id", 160);
    const scheduleFencingToken = normalizeOpaqueText(input.scheduleFencingToken, "schedule fencing token", 160);
    const reportRunFencingToken = normalizeOpaqueText(input.reportRunFencingToken, "report run fencing token", 160);
    const status = normalizeTerminalReportRunStatus(input.status);
    const finishedAt = normalizeIsoTimestamp(input.finishedAt ?? this.clock().toISOString(), "report run finishedAt");
    const deliveries = normalizeDeliveries(input.deliveries ?? []);
    const error = normalizeNullableRedactedText(input.error, "report run error", 1000);
    const reportJson = normalizeReportJsonMetadata(input.reportJson);
    const artifactRef = normalizeNullableArtifactRef(input.artifactRef, "report run artifact ref");
    return await this.withWorkspaceTransaction(workspaceId, async (client) => {
      const scheduleResult = await client.query(
        `SELECT * FROM ${this.table("report_schedules")}
         WHERE workspace_id = $1
           AND id = $2
           AND enabled = true
           AND deleted_at IS NULL
           AND claimed_by_worker_id = $3
           AND fencing_token = $4
           AND lease_expires_at > now()
         FOR UPDATE`,
        [workspaceId, scheduleId, workerId, scheduleFencingToken],
      );
      const scheduleRow = scheduleResult.rows[0];
      if (!scheduleRow || typeof scheduleRow !== "object") return null;
      const scheduleWindow = isoStringField(scheduleRow as Record<string, unknown>, "next_run_at");
      const runId = normalizeId(input.reportRunId ?? reportRunIdForScheduleWindow(workspaceId, scheduleId, scheduleWindow));
      const runResult = await client.query(
        `UPDATE ${this.table("report_runs")}
         SET status = $3,
             finished_at = $4::timestamptz,
             deliveries_json = $5::jsonb,
             error = $6,
             report_json = $7::jsonb,
             artifact_ref = $8,
             claimed_by_worker_id = NULL,
             fencing_token = NULL,
             lease_expires_at = NULL,
             updated_at = now(),
             version = version + 1
         WHERE workspace_id = $1
           AND id = $2
           AND schedule_id = $9
           AND started_at = $10::timestamptz
           AND deleted_at IS NULL
           AND status = 'running'
           AND claimed_by_worker_id = $11
           AND fencing_token = $12
           AND lease_expires_at > now()
         RETURNING *`,
        [
          workspaceId,
          runId,
          status,
          finishedAt,
          JSON.stringify(deliveries),
          error,
          reportJson ? JSON.stringify(reportJson) : null,
          artifactRef,
          scheduleId,
          scheduleWindow,
          workerId,
          reportRunFencingToken,
        ],
      );
      const runRow = runResult.rows[0];
      if (!runRow || typeof runRow !== "object") return null;
      const scheduleAdvance = await client.query(
        `UPDATE ${this.table("report_schedules")} AS report_schedule
         SET last_run_at = report_schedule.next_run_at,
             next_run_at = report_schedule.next_run_at + (report_schedule.interval_seconds::bigint * interval '1 second'),
             claimed_by_worker_id = NULL,
             fencing_token = NULL,
             lease_expires_at = NULL,
             updated_at = now(),
             version = report_schedule.version + 1
         WHERE report_schedule.workspace_id = $1
           AND report_schedule.id = $2
           AND report_schedule.deleted_at IS NULL
           AND report_schedule.claimed_by_worker_id = $3
           AND report_schedule.fencing_token = $4
           AND report_schedule.lease_expires_at > now()
           AND report_schedule.next_run_at = $5::timestamptz
         RETURNING report_schedule.*`,
        [workspaceId, scheduleId, workerId, scheduleFencingToken, scheduleWindow],
      );
      const advancedRow = scheduleAdvance.rows[0];
      if (!advancedRow || typeof advancedRow !== "object") return null;
      return {
        reportRun: reportRunFromRow(runRow as Record<string, unknown>),
        schedule: scheduleClaimFromRow(advancedRow as Record<string, unknown>),
      };
    });
  }

  async listDueReportSchedules(options: ListDuePostgresReportSchedulesOptions = {}): Promise<PostgresReportScheduleClaimRecord[]> {
    const workspaceId = normalizeWorkspaceId(options.workspaceId ?? this.workspaceId);
    const now = normalizeIsoTimestamp(options.now ?? this.clock().toISOString(), "due report schedule now");
    const limit = clampLimit(options.limit ?? 50);
    const result = await this.withWorkspaceTransaction(workspaceId, (client) => client.query(
      `SELECT * FROM ${this.table("report_schedules")}
       WHERE workspace_id = $1
         AND enabled = true
         AND deleted_at IS NULL
         AND next_run_at <= $2::timestamptz
         AND (fencing_token IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= $2::timestamptz)
       ORDER BY next_run_at ASC, created_at ASC, id ASC
       LIMIT $3`,
      [workspaceId, now, limit],
    ));
    return result.rows.map((row) => redactReportScheduleClaim(scheduleClaimFromRow(row)));
  }

  async claimReportSchedule(input: ClaimPostgresReportScheduleInput): Promise<PostgresReportScheduleClaimRecord | null> {
    const workspaceId = normalizeWorkspaceId(input.workspaceId ?? this.workspaceId);
    const id = normalizeId(input.id);
    const workerId = normalizeOpaqueText(input.workerId, "worker id", 160);
    if (input.now != null) normalizeIsoTimestamp(input.now, "report schedule claim now");
    const leaseTtlMs = normalizePositiveInteger(input.leaseTtlMs ?? 300_000, "leaseTtlMs");
    const fencingToken = `rsf_${randomUUID().replace(/-/g, "")}`;
    const result = await this.withWorkspaceTransaction(workspaceId, (client) => client.query(
      `UPDATE ${this.table("report_schedules")}
       SET claimed_by_worker_id = $3,
           fencing_token = $4,
           lease_expires_at = now() + ($5::bigint * interval '1 millisecond'),
           updated_at = now(),
           version = version + 1
       WHERE workspace_id = $1
         AND id = $2
         AND enabled = true
         AND deleted_at IS NULL
         AND next_run_at <= now()
         AND (fencing_token IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= now())
       RETURNING *`,
      [workspaceId, id, workerId, fencingToken, leaseTtlMs],
    ));
    const row = result.rows[0];
    return row ? scheduleClaimFromRow(row) : null;
  }

  async completeReportScheduleClaim(input: CompletePostgresReportScheduleClaimInput): Promise<PostgresReportScheduleClaimRecord | null> {
    const workspaceId = normalizeWorkspaceId(input.workspaceId ?? this.workspaceId);
    const id = normalizeId(input.id);
    const workerId = normalizeOpaqueText(input.workerId, "worker id", 160);
    const fencingToken = normalizeOpaqueText(input.fencingToken, "fencing token", 160);
    if (input.finishedAt != null) normalizeIsoTimestamp(input.finishedAt, "report schedule claim finishedAt");
    const result = await this.withWorkspaceTransaction(workspaceId, (client) => client.query(
      `UPDATE ${this.table("report_schedules")} AS report_schedule
       SET last_run_at = report_schedule.next_run_at,
           next_run_at = report_schedule.next_run_at + (report_schedule.interval_seconds::bigint * interval '1 second'),
           claimed_by_worker_id = NULL,
           fencing_token = NULL,
           lease_expires_at = NULL,
           updated_at = now(),
           version = report_schedule.version + 1
       WHERE report_schedule.workspace_id = $1
         AND report_schedule.id = $2
         AND report_schedule.deleted_at IS NULL
         AND report_schedule.claimed_by_worker_id = $3
         AND report_schedule.fencing_token = $4
         AND report_schedule.lease_expires_at > now()
         AND EXISTS (
           SELECT 1 FROM ${this.table("report_runs")} report_run
           WHERE report_run.workspace_id = report_schedule.workspace_id
             AND report_run.schedule_id = report_schedule.id
             AND report_run.started_at = report_schedule.next_run_at
             AND report_run.status IN ('succeeded', 'failed', 'retry_exhausted')
             AND report_run.deleted_at IS NULL
         )
       RETURNING report_schedule.*`,
      [workspaceId, id, workerId, fencingToken],
    ));
    const row = result.rows[0];
    return row ? scheduleClaimFromRow(row) : null;
  }

  async createDeliveryAttempt(input: CreatePostgresReportDeliveryAttemptInput): Promise<PostgresReportDeliveryAttemptRecord> {
    const workspaceId = normalizeWorkspaceId(input.workspaceId ?? this.workspaceId);
    const reportRunId = normalizeId(input.reportRunId);
    const channel = normalizeChannel(input.channel);
    const channelRefId = normalizeRuntimeRefId(input.channelRefId, "channel ref id", 160);
    const provider = normalizeDeliveryProvider(input.provider);
    if (provider !== expectedProviderForChannel(channel)) {
      throw new Error(`provider must be ${expectedProviderForChannel(channel)} for ${channel}`);
    }
    const attemptNumber = normalizePositiveInteger(input.attemptNumber ?? 1, "attempt number");
    const scheduledAt = normalizeIsoTimestamp(input.scheduledAt ?? this.clock().toISOString(), "delivery scheduledAt");
    const idempotencyKey = normalizeOpaqueText(
      input.idempotencyKey ?? deliveryAttemptIdempotencyKey(workspaceId, reportRunId, channel, channelRefId, attemptNumber, scheduledAt),
      "delivery idempotency key",
      256,
    );
    const id = normalizeId(input.id ?? deterministicId("rda", workspaceId, idempotencyKey));
    const result = await this.withWorkspaceTransaction(workspaceId, (client) => client.query(
      `INSERT INTO ${this.table("report_delivery_attempts")} (
        workspace_id, id, report_run_id, channel, channel_ref_id, provider,
        attempt_number, status, idempotency_key, scheduled_at, next_retry_at,
        response_status, provider_message_id, error, retry_after_seconds,
        request_hash, response_hash, actor, origin
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz,
        $12, $13, $14, $15, $16, $17, $18, $19)
      ON CONFLICT (workspace_id, idempotency_key) WHERE deleted_at IS NULL DO UPDATE SET
        updated_at = now()
      WHERE ${this.table("report_delivery_attempts")}.report_run_id IS NOT DISTINCT FROM EXCLUDED.report_run_id
        AND ${this.table("report_delivery_attempts")}.channel IS NOT DISTINCT FROM EXCLUDED.channel
        AND ${this.table("report_delivery_attempts")}.channel_ref_id IS NOT DISTINCT FROM EXCLUDED.channel_ref_id
        AND ${this.table("report_delivery_attempts")}.provider IS NOT DISTINCT FROM EXCLUDED.provider
        AND ${this.table("report_delivery_attempts")}.attempt_number IS NOT DISTINCT FROM EXCLUDED.attempt_number
        AND ${this.table("report_delivery_attempts")}.request_hash IS NOT DISTINCT FROM EXCLUDED.request_hash
      RETURNING *`,
      [
        workspaceId,
        id,
        reportRunId,
        channel,
        channelRefId,
        provider,
        attemptNumber,
        normalizeDeliveryAttemptStatus(input.status ?? "pending"),
        idempotencyKey,
        scheduledAt,
        normalizeNullableIsoTimestamp(input.nextRetryAt, "delivery nextRetryAt"),
        normalizeNullableHttpStatus(input.responseStatus),
        normalizeNullableOpaqueText(input.providerMessageId, "provider message id", 200),
        normalizeNullableRedactedText(input.error, "delivery error", 1000),
        normalizeNullablePositiveInteger(input.retryAfterSeconds, "retryAfterSeconds"),
        normalizeNullableSha256(input.requestHash, "request hash"),
        normalizeNullableSha256(input.responseHash, "response hash"),
        normalizeNullableOpaqueText(input.actor, "delivery actor", 160),
        normalizeNullableOpaqueText(input.origin, "delivery origin", 160),
      ],
    ));
    const row = result.rows[0];
    if (!row) throw new Error("delivery attempt idempotency conflict");
    return deliveryAttemptFromRow(row as Record<string, unknown>);
  }

  async listDueDeliveryAttempts(options: ListDuePostgresReportDeliveryAttemptsOptions = {}): Promise<PostgresReportDeliveryAttemptRecord[]> {
    const workspaceId = normalizeWorkspaceId(options.workspaceId ?? this.workspaceId);
    const now = normalizeIsoTimestamp(options.now ?? this.clock().toISOString(), "due delivery now");
    const limit = clampLimit(options.limit ?? 50);
    const result = await this.withWorkspaceTransaction(workspaceId, (client) => client.query(
      `SELECT * FROM ${this.table("report_delivery_attempts")}
       WHERE workspace_id = $1
         AND deleted_at IS NULL
         AND (
           (status IN ('pending', 'failed') AND COALESCE(next_retry_at, scheduled_at) <= $2::timestamptz)
           OR (status = 'sending' AND lease_expires_at <= $2::timestamptz)
         )
       ORDER BY COALESCE(next_retry_at, lease_expires_at, scheduled_at) ASC, created_at ASC, id ASC
       LIMIT $3`,
      [workspaceId, now, limit],
    ));
    return result.rows.map((row) => redactDeliveryAttemptForDiscovery(deliveryAttemptFromRow(row)));
  }

  async claimDeliveryAttempt(input: ClaimPostgresReportDeliveryAttemptInput): Promise<PostgresReportDeliveryAttemptRecord | null> {
    const workspaceId = normalizeWorkspaceId(input.workspaceId ?? this.workspaceId);
    const id = normalizeId(input.id);
    const workerId = normalizeOpaqueText(input.workerId, "worker id", 160);
    const leaseTtlMs = normalizePositiveInteger(input.leaseTtlMs ?? 300_000, "leaseTtlMs");
    const fencingToken = `rft_${randomUUID().replace(/-/g, "")}`;
    const result = await this.withWorkspaceTransaction(workspaceId, (client) => client.query(
      `UPDATE ${this.table("report_delivery_attempts")}
       SET status = 'sending',
           claimed_by_worker_id = $3,
           fencing_token = $4,
           started_at = COALESCE(started_at, now()),
           lease_expires_at = now() + ($5::bigint * interval '1 millisecond'),
           updated_at = now(),
           version = version + 1
       WHERE workspace_id = $1
         AND id = $2
         AND deleted_at IS NULL
         AND (
           (status IN ('pending', 'failed') AND COALESCE(next_retry_at, scheduled_at) <= now())
           OR (status = 'sending' AND lease_expires_at <= now())
         )
       RETURNING *`,
      [workspaceId, id, workerId, fencingToken, leaseTtlMs],
    ));
    const row = result.rows[0];
    return row ? deliveryAttemptFromRow(row) : null;
  }

  async completeDeliveryAttempt(input: CompletePostgresReportDeliveryAttemptInput): Promise<PostgresReportDeliveryAttemptRecord | null> {
    const workspaceId = normalizeWorkspaceId(input.workspaceId ?? this.workspaceId);
    const id = normalizeId(input.id);
    const finishedAt = normalizeIsoTimestamp(input.finishedAt ?? this.clock().toISOString(), "delivery finishedAt");
    const status = normalizeTerminalDeliveryAttemptStatus(input.status);
    if (status === "failed" && input.nextRetryAt == null) {
      throw new Error("failed delivery attempts require nextRetryAt or retry_exhausted");
    }
    const fencingToken = normalizeOpaqueText(input.fencingToken, "fencing token", 160);
    const result = await this.withWorkspaceTransaction(workspaceId, (client) => client.query(
      `UPDATE ${this.table("report_delivery_attempts")}
       SET status = $3,
           finished_at = $4::timestamptz,
           next_retry_at = $5::timestamptz,
           response_status = $6,
           provider_message_id = $7,
           error = $8,
           retry_after_seconds = $9,
           response_hash = $10,
           claimed_by_worker_id = NULL,
           lease_expires_at = NULL,
           fencing_token = NULL,
           updated_at = now(),
           version = version + 1
       WHERE workspace_id = $1
         AND id = $2
         AND deleted_at IS NULL
         AND status = 'sending'
         AND lease_expires_at > now()
         AND fencing_token = $11
       RETURNING *`,
      [
        workspaceId,
        id,
        status,
        finishedAt,
        normalizeNullableIsoTimestamp(input.nextRetryAt, "delivery nextRetryAt"),
        normalizeNullableHttpStatus(input.responseStatus),
        normalizeNullableOpaqueText(input.providerMessageId, "provider message id", 200),
        normalizeNullableRedactedText(input.error, "delivery error", 1000),
        normalizeNullablePositiveInteger(input.retryAfterSeconds, "retryAfterSeconds"),
        normalizeNullableSha256(input.responseHash, "response hash"),
        fencingToken,
      ],
    ));
    const row = result.rows[0];
    return row ? deliveryAttemptFromRow(row) : null;
  }

  async recordArtifact(input: RecordPostgresReportArtifactInput): Promise<PostgresReportArtifactRecord> {
    const workspaceId = normalizeWorkspaceId(input.workspaceId ?? this.workspaceId);
    const reportRunId = normalizeId(input.reportRunId);
    const artifactType = normalizeArtifactType(input.artifactType);
    const sha256 = normalizeSha256(input.sha256, "artifact sha256");
    const id = normalizeId(input.id ?? deterministicId("rpa", workspaceId, reportRunId, artifactType, sha256));
    if (input.redacted === false) throw new Error("report artifacts must be redacted before metadata is recorded");
    const result = await this.withWorkspaceTransaction(workspaceId, (client) => client.query(
      `INSERT INTO ${this.table("report_artifacts")} (
        workspace_id, id, report_run_id, artifact_type, storage_ref, sha256, byte_size,
        redacted, retention_class, kms_key_ref, actor, origin, idempotency_key
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (workspace_id, report_run_id, artifact_type, sha256) DO UPDATE SET
        storage_ref = EXCLUDED.storage_ref,
        byte_size = EXCLUDED.byte_size,
        redacted = EXCLUDED.redacted,
        retention_class = EXCLUDED.retention_class,
        kms_key_ref = EXCLUDED.kms_key_ref,
        updated_at = now()
      RETURNING *`,
      [
        workspaceId,
        id,
        reportRunId,
        artifactType,
        normalizeArtifactRef(input.storageRef, "artifact storage ref"),
        sha256,
        normalizeNonNegativeInteger(input.byteSize, "artifact byteSize"),
        true,
        normalizeRetentionClass(input.retentionClass ?? "standard"),
        normalizeNullableOpaqueText(input.kmsKeyRef, "artifact kms key ref", 300),
        normalizeNullableOpaqueText(input.actor, "artifact actor", 160),
        normalizeNullableOpaqueText(input.origin, "artifact origin", 160),
        normalizeNullableOpaqueText(input.idempotencyKey, "artifact idempotency key", 256),
      ],
    ));
    return artifactFromRow(firstRow(result, "report artifact"));
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

export function createPostgresReportRuntime(options: PostgresReportRuntimeOptions = {}): PostgresReportRuntime {
  return new PostgresReportRuntime(options);
}

export function buildPostgresReportRuntimeReadiness(options: Pick<PostgresReportRuntimeOptions, "databaseUrl" | "schemaName" | "workspaceId" | "workspaceSetting"> & {
  schemaVerified?: boolean;
} = {}): PostgresReportRuntimeReadiness {
  const plan = buildPostgresMigrationPlan({
    databaseUrl: options.databaseUrl ?? process.env.HASNA_UPTIME_DATABASE_URL,
    schemaName: options.schemaName,
    workspaceSetting: options.workspaceSetting,
  });
  const workspaceId = normalizeOptionalWorkspaceId(options.workspaceId ?? process.env.HASNA_UPTIME_WORKSPACE_ID);
  const migrationBlockers = plan.blockers.filter((blocker) => !blocker.startsWith("async-runtime-adapter:"));
  const schemaVerified = options.schemaVerified === true;
  const metadataChecks = [
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
      name: "report-runtime-schema-verified",
      ok: schemaVerified,
      detail: schemaVerified ? "caller supplied schema verification evidence" : "not verified in this process",
    },
    { name: "report-run-metadata-writer", ok: true, detail: "implemented for report_runs metadata" },
    { name: "report-run-state-machine", ok: true, detail: "pending/running/terminal report run state machine with worker lease and fencing is implemented" },
    { name: "report-schedule-claiming", ok: true, detail: "transactional report schedule/window claiming with worker lease and fencing is implemented" },
    { name: "report-delivery-attempt-state", ok: true, detail: "implemented for pending/sending/succeeded/failed/retry_exhausted" },
    { name: "report-delivery-idempotency", ok: true, detail: "stable idempotency keys and duplicate suppression are implemented" },
    { name: "report-delivery-retry-backoff", ok: true, detail: "next_retry_at and retry_after_seconds metadata are implemented" },
    { name: "report-artifact-metadata-writer", ok: true, detail: "implemented for redacted artifact metadata refs only" },
  ];
  const promotionChecks = [
    { name: "report-artifact-object-store", ok: false, detail: "S3/object artifact writing and signing are not implemented" },
    { name: "report-audit-export", ok: false, detail: "delivery audit export to Open Logs is not implemented" },
    { name: "report-delivery-alarms", ok: false, detail: "reporter lag, failed delivery, and retry-exhaustion alarms are not proven" },
    { name: "reporter-worker-liveness", ok: false, detail: "live reporter worker leases, drain, and rollback evidence are not proven" },
  ];
  const checks = [...metadataChecks, ...promotionChecks];
  const metadataBlockers = [
    ...migrationBlockers,
    ...metadataChecks.filter((check) => !check.ok).map((check) => `${check.name}: ${check.detail}`),
  ];
  const blockers = [
    ...metadataBlockers,
    ...promotionChecks.filter((check) => !check.ok).map((check) => `${check.name}: ${check.detail}`),
  ];
  return {
    kind: "open-uptime.postgres-report-runtime-readiness",
    version: POSTGRES_REPORT_RUNTIME_VERSION,
    status: blockers.length === 0 ? "ready" : "blocked",
    canWriteReportMetadata: metadataBlockers.length === 0,
    schemaName: plan.schemaName,
    workspaceId,
    database: {
      configured: plan.database.configured,
      redactedUrl: plan.database.redactedUrl,
    },
    checks,
    blockers,
    capabilities: {
      reportRunWriter: true,
      scheduleClaiming: true,
      reportRunStateMachine: true,
      deliveryAttemptState: true,
      deliveryIdempotency: true,
      retryBackoffMetadata: true,
      artifactMetadataWriter: true,
      artifactObjectWriter: false,
      auditExport: false,
      deliveryAlarms: false,
    },
  };
}

export function deliveryAttemptIdempotencyKey(
  workspaceId: string,
  reportRunId: string,
  channel: ReportDeliveryChannel,
  channelRefId: string,
  attemptNumber: number,
  _scheduledAt?: string,
): string {
  return `sha256:${sha256([
    "open-uptime.report-delivery-attempt.v1",
    workspaceId,
    reportRunId,
    channel,
    channelRefId,
    String(attemptNumber),
  ].join("\u001f"))}`;
}

export function reportRunScheduleWindowIdempotencyKey(workspaceId: string, scheduleId: string, scheduleWindow: string): string {
  return `sha256:${sha256([
    "open-uptime.report-run-schedule-window.v1",
    workspaceId,
    scheduleId,
    normalizeIsoTimestamp(scheduleWindow, "report schedule window"),
  ].join("\u001f"))}`;
}

export function reportRunIdForScheduleWindow(workspaceId: string, scheduleId: string, scheduleWindow: string): string {
  return deterministicId("rpr", workspaceId, reportRunScheduleWindowIdempotencyKey(workspaceId, scheduleId, scheduleWindow));
}

export function sanitizePostgresReportRuntimeError(error: unknown, databaseUrl?: string): string {
  let message = error instanceof Error ? error.message : String(error);
  if (databaseUrl) message = message.split(databaseUrl).join(redactPostgresUrl(databaseUrl));
  return message
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^@\s/:]+):([^@\s/]*)@/gi, (match, protocol: string, user: string, password: string) =>
      user === "user" && password === "redacted" ? match : `${protocol}[REDACTED]:[REDACTED]@`)
    .replace(/(password|passwd|pwd|token|access[_-]?token|secret|api[_-]?key|key|credential|signature|sig|jwt|code|session|auth|oauth)=([^&\s]+)/gi, "$1=redacted")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer redacted")
    .replace(/\b(esk|sk)_[A-Za-z0-9._~+/=-]+/g, "$1_redacted");
}

function reportRunFromRow(row: Record<string, unknown>): PostgresReportRunRecord {
  return {
    workspaceId: stringField(row, "workspace_id"),
    id: stringField(row, "id"),
    scheduleId: nullableStringField(row, "schedule_id"),
    status: normalizeReportRunStatus(stringField(row, "status")),
    startedAt: isoStringField(row, "started_at"),
    finishedAt: nullableIsoStringField(row, "finished_at"),
    deliveries: parseDeliveries(row.deliveries_json),
    error: nullableStringField(row, "error"),
    reportJson: parseRecord(row.report_json),
    artifactRef: nullableStringField(row, "artifact_ref"),
    actor: nullableStringField(row, "actor"),
    origin: nullableStringField(row, "origin"),
    idempotencyKey: nullableStringField(row, "idempotency_key"),
    claimedByWorkerId: nullableStringField(row, "claimed_by_worker_id"),
    fencingToken: nullableStringField(row, "fencing_token"),
    leaseExpiresAt: nullableIsoStringField(row, "lease_expires_at"),
    version: numberField(row, "version"),
  };
}

function scheduleClaimFromRow(row: Record<string, unknown>): PostgresReportScheduleClaimRecord {
  return {
    workspaceId: stringField(row, "workspace_id"),
    id: stringField(row, "id"),
    name: stringField(row, "name"),
    enabled: Boolean(row.enabled),
    intervalSeconds: numberField(row, "interval_seconds"),
    nextRunAt: isoStringField(row, "next_run_at"),
    lastRunAt: nullableIsoStringField(row, "last_run_at"),
    subject: nullableStringField(row, "subject"),
    channels: summarizeScheduleChannels(row.channels_json),
    claimedByWorkerId: nullableStringField(row, "claimed_by_worker_id"),
    fencingToken: nullableStringField(row, "fencing_token"),
    leaseExpiresAt: nullableIsoStringField(row, "lease_expires_at"),
    version: numberField(row, "version"),
  };
}

function redactReportScheduleClaim(record: PostgresReportScheduleClaimRecord): PostgresReportScheduleClaimRecord {
  return { ...record, fencingToken: null };
}

function deliveryAttemptFromRow(row: Record<string, unknown>): PostgresReportDeliveryAttemptRecord {
  return {
    workspaceId: stringField(row, "workspace_id"),
    id: stringField(row, "id"),
    reportRunId: stringField(row, "report_run_id"),
    channel: normalizeChannel(stringField(row, "channel")),
    channelRefId: stringField(row, "channel_ref_id"),
    provider: stringField(row, "provider"),
    attemptNumber: numberField(row, "attempt_number"),
    status: normalizeDeliveryAttemptStatus(stringField(row, "status")),
    idempotencyKey: stringField(row, "idempotency_key"),
    scheduledAt: isoStringField(row, "scheduled_at"),
    startedAt: nullableIsoStringField(row, "started_at"),
    finishedAt: nullableIsoStringField(row, "finished_at"),
    nextRetryAt: nullableIsoStringField(row, "next_retry_at"),
    responseStatus: nullableNumberField(row, "response_status"),
    providerMessageId: nullableStringField(row, "provider_message_id"),
    error: nullableStringField(row, "error"),
    retryAfterSeconds: nullableNumberField(row, "retry_after_seconds"),
    requestHash: nullableStringField(row, "request_hash"),
    responseHash: nullableStringField(row, "response_hash"),
    claimedByWorkerId: nullableStringField(row, "claimed_by_worker_id"),
    fencingToken: nullableStringField(row, "fencing_token"),
    leaseExpiresAt: nullableIsoStringField(row, "lease_expires_at"),
    version: numberField(row, "version"),
  };
}

function redactDeliveryAttemptForDiscovery(record: PostgresReportDeliveryAttemptRecord): PostgresReportDeliveryAttemptRecord {
  return { ...record, fencingToken: null };
}

function artifactFromRow(row: Record<string, unknown>): PostgresReportArtifactRecord {
  return {
    workspaceId: stringField(row, "workspace_id"),
    id: stringField(row, "id"),
    reportRunId: stringField(row, "report_run_id"),
    artifactType: normalizeArtifactType(stringField(row, "artifact_type")),
    storageRef: stringField(row, "storage_ref"),
    sha256: stringField(row, "sha256"),
    byteSize: numberField(row, "byte_size"),
    redacted: Boolean(row.redacted),
    retentionClass: normalizeRetentionClass(stringField(row, "retention_class")),
    kmsKeyRef: nullableStringField(row, "kms_key_ref"),
    actor: nullableStringField(row, "actor"),
    origin: nullableStringField(row, "origin"),
    idempotencyKey: nullableStringField(row, "idempotency_key"),
  };
}

function firstRow(result: { rows: unknown[] }, label: string): Record<string, unknown> {
  const row = result.rows[0];
  if (!row || typeof row !== "object") throw new Error(`Postgres did not return ${label}`);
  return row as Record<string, unknown>;
}

function parseDeliveries(value: unknown): ReportDeliveryRecord[] {
  const parsed = typeof value === "string" ? parseJson(value) : value;
  return Array.isArray(parsed) ? parsed as ReportDeliveryRecord[] : [];
}

function parseRecord(value: unknown): Record<string, unknown> | null {
  const parsed = typeof value === "string" ? parseJson(value) : value;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
}

function summarizeScheduleChannels(value: unknown): PostgresReportScheduleChannelSummary {
  const parsed = typeof value === "string" ? parseJson(value) : value;
  const record = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
  return {
    email: Boolean(record.email),
    sms: Boolean(record.sms),
    logs: Boolean(record.logs),
  };
}

function normalizeReportJsonMetadata(value: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (value == null) return null;
  return {
    kind: "open-uptime.report-json-metadata",
    sha256: sha256(JSON.stringify(value)),
    redacted: true,
    storage: "artifact-required",
  };
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeDeliveries(deliveries: ReportDeliveryRecord[]): ReportDeliveryRecord[] {
  return deliveries.map((delivery) => ({
    channel: normalizeChannel(delivery.channel),
    ok: Boolean(delivery.ok),
    status: delivery.status === undefined ? undefined : normalizeNullableHttpStatus(delivery.status) ?? undefined,
    id: delivery.id === undefined ? undefined : normalizeOpaqueText(delivery.id, "delivery provider id", 200),
    error: delivery.error === undefined ? undefined : normalizeNullableRedactedText(delivery.error, "delivery error", 1000) ?? undefined,
  }));
}

function normalizeReportRunStatus(value: string): PostgresReportRunStatus {
  if (value === "success") return "succeeded";
  if (value === "pending" || value === "running" || value === "succeeded" || value === "failed" || value === "retry_exhausted") return value;
  throw new Error("report run status must be pending, running, succeeded, failed, or retry_exhausted");
}

function normalizeTerminalReportRunStatus(value: string): Extract<PostgresReportRunStatus, "succeeded" | "failed" | "retry_exhausted"> {
  if (value === "succeeded" || value === "failed" || value === "retry_exhausted") return value;
  throw new Error("report run completion status must be succeeded, failed, or retry_exhausted");
}

function isTerminalReportRunStatus(value: PostgresReportRunStatus): boolean {
  return value === "succeeded" || value === "failed" || value === "retry_exhausted";
}

function normalizeChannel(value: string): ReportDeliveryChannel {
  if (value === "email" || value === "sms" || value === "logs") return value;
  throw new Error("report delivery channel must be email, sms, or logs");
}

function normalizeDeliveryAttemptStatus(value: string): PostgresReportDeliveryAttemptStatus {
  if (value === "pending" || value === "sending" || value === "succeeded" || value === "failed" || value === "retry_exhausted") return value;
  throw new Error("delivery attempt status is invalid");
}

function normalizeTerminalDeliveryAttemptStatus(value: string): Extract<PostgresReportDeliveryAttemptStatus, "succeeded" | "failed" | "retry_exhausted"> {
  if (value === "succeeded" || value === "failed" || value === "retry_exhausted") return value;
  throw new Error("delivery completion status must be succeeded, failed, or retry_exhausted");
}

function normalizeArtifactType(value: string): PostgresReportArtifactType {
  if (value === "json" || value === "html" || value === "pdf" || value === "summary") return value;
  throw new Error("report artifact type is invalid");
}

function normalizeRetentionClass(value: string): PostgresReportArtifactRetentionClass {
  if (value === "standard" || value === "compliance" || value === "legal_hold") return value;
  throw new Error("report artifact retention class is invalid");
}

function normalizeSchemaName(value: string): string {
  const trimmed = value.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(trimmed)) throw new Error("Postgres schema name must be a safe identifier");
  return trimmed;
}

function normalizeWorkspaceId(value: string): string {
  return normalizeOpaqueText(value, "workspace id", 128);
}

function normalizeWorkspaceSetting(value: string): string {
  const trimmed = value.trim();
  if (!/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)+$/.test(trimmed)) {
    throw new Error("workspace setting must be a dotted lowercase setting such as app.workspace_id");
  }
  return trimmed;
}

function normalizeOptionalWorkspaceId(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  return normalizeWorkspaceId(value);
}

function normalizeId(value: string): string {
  return normalizeOpaqueText(value, "id", 160);
}

function normalizeOpaqueText(value: string, label: string, maxLength: number): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required`);
  if (trimmed.length > maxLength) throw new Error(`${label} is too long`);
  if (/[\x00-\x1f\x7f-\x9f]/.test(trimmed)) throw new Error(`${label} must not contain control characters`);
  if (looksSecretLike(trimmed)) throw new Error(`${label} must be an opaque reference, not secret material`);
  return trimmed;
}

function normalizeNullableOpaqueText(value: string | null | undefined, label: string, maxLength: number): string | null {
  if (value == null || value.trim() === "") return null;
  return normalizeOpaqueText(value, label, maxLength);
}

function normalizeNullableRedactedText(value: string | null | undefined, label: string, maxLength: number): string | null {
  if (value == null || value.trim() === "") return null;
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new Error(`${label} is too long`);
  return sanitizePostgresReportRuntimeError(trimmed);
}

function normalizeRuntimeRefId(value: string, label: string, maxLength: number): string {
  const ref = normalizeOpaqueText(value, label, maxLength);
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ref)) throw new Error(`${label} must not be a raw email address`);
  if (/^[\d_.:+()-]+$/.test(ref) && ref.replace(/\D/g, "").length >= 7) throw new Error(`${label} must not be a raw phone number`);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(ref)) throw new Error(`${label} must not be a URL`);
  return ref;
}

function normalizeDeliveryProvider(value: string): "mailery" | "telephony" | "logs" {
  const provider = normalizeOpaqueText(value, "provider", 80);
  if (provider === "mailery" || provider === "telephony" || provider === "logs") return provider;
  throw new Error("provider must be mailery, telephony, or logs");
}

function expectedProviderForChannel(channel: ReportDeliveryChannel): "mailery" | "telephony" | "logs" {
  if (channel === "email") return "mailery";
  if (channel === "sms") return "telephony";
  return "logs";
}

function normalizeIsoTimestamp(value: string, label: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(`${label} must be an ISO timestamp`);
  return new Date(time).toISOString();
}

function normalizeNullableIsoTimestamp(value: string | null | undefined, label: string): string | null {
  if (value == null || value.trim() === "") return null;
  return normalizeIsoTimestamp(value, label);
}

function normalizePositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}

function normalizeNonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  return value;
}

function normalizeNullablePositiveInteger(value: number | null | undefined, label: string): number | null {
  if (value == null) return null;
  return normalizePositiveInteger(value, label);
}

function normalizeNullableHttpStatus(value: number | null | undefined): number | null {
  if (value == null) return null;
  if (!Number.isInteger(value) || value < 100 || value > 599) throw new Error("response status must be an HTTP status from 100 to 599");
  return value;
}

function normalizeSha256(value: string, label: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(trimmed)) throw new Error(`${label} must be a sha256 hex digest`);
  return trimmed;
}

function normalizeNullableSha256(value: string | null | undefined, label: string): string | null {
  if (value == null || value.trim() === "") return null;
  return normalizeSha256(value, label);
}

function normalizeArtifactRef(value: string, label: string): string {
  const ref = normalizeOpaqueText(value, label, 500);
  if (!ref.startsWith("s3://") && !ref.startsWith("artifact://")) {
    throw new Error(`${label} must use s3:// or artifact://`);
  }
  if (ref.startsWith("/") || ref.toLowerCase().startsWith("file:")) {
    throw new Error(`${label} must not be a local file path`);
  }
  if (ref.includes("?") || ref.includes("#")) {
    throw new Error(`${label} must not include query strings or fragments`);
  }
  if (/[?&](token|secret|password|api[_-]?key|signature|credential)=/i.test(ref)) {
    throw new Error(`${label} must not contain secret query parameters`);
  }
  return ref;
}

function normalizeNullableArtifactRef(value: string | null | undefined, label: string): string | null {
  if (value == null || value.trim() === "") return null;
  return normalizeArtifactRef(value, label);
}

function clampLimit(value: number): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error("limit must be a positive integer");
  return Math.min(value, 500);
}

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  throw new Error(`Postgres row field ${key} is missing`);
}

function nullableStringField(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function isoStringField(row: Record<string, unknown>, key: string): string {
  return normalizeIsoTimestamp(stringField(row, key), key);
}

function nullableIsoStringField(row: Record<string, unknown>, key: string): string | null {
  const value = nullableStringField(row, key);
  return value == null ? null : normalizeIsoTimestamp(value, key);
}

function numberField(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  throw new Error(`Postgres row field ${key} is not a number`);
}

function nullableNumberField(row: Record<string, unknown>, key: string): number | null {
  if (row[key] == null) return null;
  return numberField(row, key);
}

function deterministicId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${sha256(parts.join("\u001f")).slice(0, 32)}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

async function rollbackQuietly(client: PostgresQueryClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original report-runtime error.
  }
}

function looksSecretLike(value: string): boolean {
  if (/^Bearer\s+/i.test(value)) return true;
  if (/\b(password|passwd|pwd|token|access[_-]?token|secret|api[_-]?key|key|credential|private[_-]?key|signature|sig|jwt|code|session|auth|oauth)=/i.test(value)) return true;
  if (/^(esk|sk)_[A-Za-z0-9._~+/=-]{12,}/.test(value)) return true;
  if (/^postgres(?:ql)?:\/\//i.test(value)) return true;
  return false;
}

type PostgresTransactionClient = PostgresQueryClient & { release?: () => void };
type PostgresReportRuntimeClient = PostgresQueryClient & { connect?: () => Promise<PostgresTransactionClient> };
