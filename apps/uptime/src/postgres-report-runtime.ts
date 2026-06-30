import { createHash, randomUUID } from "node:crypto";
import { sanitizeEvidenceInput } from "./evidence-sanitizer.js";
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
  promotionEvidenceJson?: string | null;
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
    artifactObjectWriterContract: boolean;
    artifactObjectWriter: boolean;
    auditExportContract: boolean;
    auditExport: boolean;
    deliveryAlarms: boolean;
    reporterWorkerLiveness: boolean;
  };
}

export interface PostgresReportRuntimePromotionEvidence {
  version: "open-uptime.reporter-promotion-evidence.v1";
  redacted: true;
  workspaceId?: string;
  checkedAt?: string;
  checks: {
    artifactObjectStore?: PostgresReportRuntimeArtifactObjectStoreEvidence;
    auditExport?: PostgresReportRuntimeAuditExportEvidence;
    deliveryAlarms?: PostgresReportRuntimeDeliveryAlarmsEvidence;
    workerLiveness?: PostgresReportRuntimeWorkerLivenessEvidence;
  };
}

export interface PostgresReportRuntimeArtifactObjectStoreEvidence {
  ok: boolean;
  reviewed: boolean;
  smokePassed: boolean;
  encrypted: boolean;
  redactedOnly: boolean;
  workspaceScoped: boolean;
  detail?: string;
}

export interface PostgresReportRuntimeAuditExportEvidence {
  ok: boolean;
  reviewed: boolean;
  smokePassed: boolean;
  redactedOnly: boolean;
  workspaceScoped: boolean;
  service: "logs";
  detail?: string;
}

export interface PostgresReportRuntimeDeliveryAlarmsEvidence {
  ok: boolean;
  reviewed: boolean;
  alarmCount: number;
  actionsConfigured: boolean;
  reporterMetricsReviewed: boolean;
  detail?: string;
}

export interface PostgresReportRuntimeWorkerLivenessEvidence {
  ok: boolean;
  reviewed: boolean;
  sustainedRunSeconds: number;
  drainProven: boolean;
  rollbackProven: boolean;
  detail?: string;
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

export type PostgresReportArtifactBody = string | Uint8Array | Record<string, unknown>;

export interface PostgresReportArtifactObjectWriteInput {
  workspaceId: string;
  reportRunId: string;
  artifactType: PostgresReportArtifactType;
  suggestedKey: string;
  contentType: string;
  body: Uint8Array;
  sha256: string;
  byteSize: number;
  redacted: true;
  retentionClass: PostgresReportArtifactRetentionClass;
  actor: string | null;
  origin: string | null;
  idempotencyKey: string | null;
}

export interface PostgresReportArtifactObjectWriteResult {
  storageRef: string;
  sha256?: string;
  byteSize?: number;
  kmsKeyRef?: string | null;
  etag?: string | null;
  versionId?: string | null;
}

export type PostgresReportArtifactObjectWriter = (
  input: PostgresReportArtifactObjectWriteInput,
) => Promise<PostgresReportArtifactObjectWriteResult> | PostgresReportArtifactObjectWriteResult;

export interface WritePostgresReportArtifactInput {
  runtime: PostgresReportRuntime;
  workspaceId?: string;
  reportRunId: string;
  artifactType: PostgresReportArtifactType;
  body: PostgresReportArtifactBody;
  contentType?: string;
  retentionClass?: PostgresReportArtifactRetentionClass;
  actor?: string | null;
  origin?: string | null;
  idempotencyKey?: string | null;
  writer: PostgresReportArtifactObjectWriter;
}

export interface WritePostgresReportArtifactResult {
  artifact: PostgresReportArtifactRecord;
  object: {
    storageRef: string;
    sha256: string;
    byteSize: number;
    kmsKeyRef: string | null;
    etag: string | null;
    versionId: string | null;
  };
}

export interface PostgresReportAuditExportEvent {
  kind: "open-uptime.report-audit";
  version: 1;
  eventId: string;
  idempotencyKey: string;
  workspaceIdHash: string;
  reportRunId: string | null;
  deliveryAttemptId: string | null;
  action: string;
  status: "succeeded" | "failed" | "retry_exhausted" | "artifact_written" | "artifact_failed";
  occurredAt: string;
  channel: ReportDeliveryChannel | null;
  channelRefId: string | null;
  provider: "mailery" | "telephony" | "logs" | null;
  requestHash: string | null;
  responseHash: string | null;
  artifactRefHash: string | null;
  metadata: Record<string, unknown>;
  redacted: true;
}

export interface BuildPostgresReportAuditEventInput {
  workspaceId?: string;
  reportRunId?: string | null;
  deliveryAttemptId?: string | null;
  action: string;
  status: PostgresReportAuditExportEvent["status"];
  occurredAt?: string;
  channel?: ReportDeliveryChannel | null;
  channelRefId?: string | null;
  provider?: "mailery" | "telephony" | "logs" | null;
  requestHash?: string | null;
  responseHash?: string | null;
  artifactRef?: string | null;
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown>;
}

export interface PostgresReportAuditExportResult {
  ok: boolean;
  id?: string | null;
  status?: number | null;
  error?: string | null;
  redacted: true;
}

export type PostgresReportAuditExporter = (
  event: PostgresReportAuditExportEvent,
) => Promise<PostgresReportAuditExportResult> | PostgresReportAuditExportResult;

export interface ExportPostgresReportAuditEventInput extends BuildPostgresReportAuditEventInput {
  exporter: PostgresReportAuditExporter;
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
        normalizeNullableProviderEvidenceId(input.providerMessageId, "provider message id", 200),
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
        normalizeNullableProviderEvidenceId(input.providerMessageId, "provider message id", 200),
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
        normalizeNullableProviderEvidenceId(input.kmsKeyRef, "artifact kms key ref", 300),
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

export async function writePostgresReportArtifact(input: WritePostgresReportArtifactInput): Promise<WritePostgresReportArtifactResult> {
  const workspaceId = resolveHostedHelperWorkspaceId(input.workspaceId, "report artifact writer");
  const reportRunId = normalizeId(input.reportRunId);
  const artifactType = normalizeArtifactType(input.artifactType);
  const retentionClass = normalizeRetentionClass(input.retentionClass ?? "standard");
  const actor = normalizeNullableOpaqueText(input.actor, "artifact actor", 160);
  const origin = normalizeNullableOpaqueText(input.origin, "artifact origin", 160);
  const contentType = normalizeContentType(input.contentType ?? defaultArtifactContentType(artifactType));
  const body = normalizeArtifactBody(input.body);
  assertSafeReportArtifactBody(body);
  const sha = sha256Bytes(body);
  const byteSize = body.byteLength;
  const idempotencyKey = normalizeArtifactIdempotencyKey(input.idempotencyKey, workspaceId, reportRunId, artifactType, sha);
  const suggestedKey = suggestedArtifactKey(workspaceId, reportRunId, artifactType, sha);
  let object: PostgresReportArtifactObjectWriteResult;
  try {
    object = await input.writer({
      workspaceId,
      reportRunId,
      artifactType,
      suggestedKey,
      contentType,
      body,
      sha256: sha,
      byteSize,
      redacted: true,
      retentionClass,
      actor,
      origin,
      idempotencyKey,
    });
  } catch (error) {
    throw new Error(sanitizeUnsafeAuditError(sanitizePostgresReportRuntimeError(error)));
  }
  const storageRef = normalizeArtifactRef(object.storageRef, "artifact object storage ref");
  const objectSha = object.sha256 == null ? sha : normalizeSha256(object.sha256, "artifact object sha256");
  const objectByteSize = object.byteSize == null ? byteSize : normalizeNonNegativeInteger(object.byteSize, "artifact object byteSize");
  if (objectSha !== sha) throw new Error("artifact object writer returned a mismatched sha256");
  if (objectByteSize !== byteSize) throw new Error("artifact object writer returned a mismatched byteSize");
  const artifact = await input.runtime.recordArtifact({
    workspaceId,
    reportRunId,
    artifactType,
    storageRef,
    sha256: sha,
    byteSize,
    redacted: true,
    retentionClass,
    kmsKeyRef: object.kmsKeyRef ?? null,
    actor,
    origin,
    idempotencyKey,
  });
  return {
    artifact,
    object: {
      storageRef,
      sha256: sha,
      byteSize,
      kmsKeyRef: artifact.kmsKeyRef,
      etag: normalizeNullableProviderEvidenceId(object.etag ?? null, "artifact object etag", 160),
      versionId: normalizeNullableProviderEvidenceId(object.versionId ?? null, "artifact object version id", 200),
    },
  };
}

export function buildPostgresReportAuditEvent(input: BuildPostgresReportAuditEventInput): PostgresReportAuditExportEvent {
  const workspaceId = resolveHostedHelperWorkspaceId(input.workspaceId, "report audit export");
  const channel = input.channel == null ? null : normalizeChannel(input.channel);
  const provider = input.provider == null ? null : normalizeDeliveryProvider(input.provider);
  if (channel && provider && provider !== expectedProviderForChannel(channel)) {
    throw new Error(`audit provider must be ${expectedProviderForChannel(channel)} for ${channel}`);
  }
  const base = {
    kind: "open-uptime.report-audit",
    version: 1,
    workspaceIdHash: sha256(workspaceId),
    reportRunId: normalizeNullableOpaqueText(input.reportRunId, "report run id", 160),
    deliveryAttemptId: normalizeNullableOpaqueText(input.deliveryAttemptId, "delivery attempt id", 160),
    action: normalizeOpaqueText(input.action, "audit action", 120),
    status: normalizeAuditStatus(input.status),
    occurredAt: normalizeIsoTimestamp(input.occurredAt ?? new Date().toISOString(), "audit occurredAt"),
    channel,
    channelRefId: input.channelRefId == null ? null : normalizeRuntimeRefId(input.channelRefId, "audit channel ref id", 160),
    provider,
    requestHash: normalizeNullableSha256(stripSha256Prefix(input.requestHash), "audit request hash"),
    responseHash: normalizeNullableSha256(stripSha256Prefix(input.responseHash), "audit response hash"),
    artifactRefHash: input.artifactRef == null ? null : sha256(normalizeArtifactRef(input.artifactRef, "audit artifact ref")),
    metadata: normalizeAuditMetadata(input.metadata ?? {}),
    redacted: true,
  } satisfies Omit<PostgresReportAuditExportEvent, "eventId" | "idempotencyKey">;
  const idempotencyKey = normalizeAuditIdempotencyKey(input.idempotencyKey, base);
  const event: PostgresReportAuditExportEvent = {
    ...base,
    eventId: deterministicId("rae", idempotencyKey),
    idempotencyKey,
  };
  assertSafeAuditEvent(event);
  return event;
}

export async function exportPostgresReportAuditEvent(input: ExportPostgresReportAuditEventInput): Promise<PostgresReportAuditExportResult> {
  const event = buildPostgresReportAuditEvent(input);
  try {
    const result = await input.exporter(event);
    const normalized: PostgresReportAuditExportResult = {
      ok: Boolean(result.ok),
      id: result.id == null ? null : normalizeProviderEvidenceId(result.id, "audit export id", 200),
      status: result.status == null ? null : normalizeNullableHttpStatus(result.status),
      error: result.error == null ? null : sanitizeUnsafeAuditError(normalizeNullableRedactedText(result.error, "audit export error", 1000) ?? ""),
      redacted: true,
    };
    assertSafeAuditEvent(normalized);
    return normalized;
  } catch (error) {
    const message = sanitizeUnsafeAuditError(sanitizePostgresReportRuntimeError(error));
    return {
      ok: false,
      error: message,
      redacted: true,
    };
  }
}

export function buildPostgresReportRuntimeReadiness(options: Pick<PostgresReportRuntimeOptions, "databaseUrl" | "schemaName" | "workspaceId" | "workspaceSetting" | "promotionEvidenceJson"> & {
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
  const promotionEvidence = parseReporterPromotionEvidence(
    options.promotionEvidenceJson ?? process.env.HASNA_UPTIME_REPORTER_PROMOTION_EVIDENCE_JSON,
    workspaceId,
  );
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
    { name: "report-artifact-object-writer-contract", ok: true, detail: "callback-based artifact object writer validates redacted body bytes, sha256, byteSize, storage ref, retention class, and Postgres metadata recording" },
    { name: "report-audit-export-contract", ok: true, detail: "callback-based Open Logs audit export validates sanitizer-safe redacted event payloads and redacted exporter results" },
  ];
  const promotionChecks = [
    {
      name: "report-artifact-object-store",
      ok: promotionEvidence.artifactObjectStore.ok,
      detail: promotionEvidence.artifactObjectStore.detail,
    },
    {
      name: "report-audit-export",
      ok: promotionEvidence.auditExport.ok,
      detail: promotionEvidence.auditExport.detail,
    },
    {
      name: "report-delivery-alarms",
      ok: promotionEvidence.deliveryAlarms.ok,
      detail: promotionEvidence.deliveryAlarms.detail,
    },
    {
      name: "reporter-worker-liveness",
      ok: promotionEvidence.workerLiveness.ok,
      detail: promotionEvidence.workerLiveness.detail,
    },
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
      artifactObjectWriterContract: true,
      artifactObjectWriter: promotionEvidence.artifactObjectStore.ok,
      auditExportContract: true,
      auditExport: promotionEvidence.auditExport.ok,
      deliveryAlarms: promotionEvidence.deliveryAlarms.ok,
      reporterWorkerLiveness: promotionEvidence.workerLiveness.ok,
    },
  };
}

function parseReporterPromotionEvidence(raw: string | null | undefined, workspaceId: string | null): {
  artifactObjectStore: { ok: boolean; detail: string };
  auditExport: { ok: boolean; detail: string };
  deliveryAlarms: { ok: boolean; detail: string };
  workerLiveness: { ok: boolean; detail: string };
} {
  const missing = {
    artifactObjectStore: { ok: false, detail: "artifact object writer contract exists, but approved S3/object storage wiring, signing, IAM, and smoke evidence are not proven" },
    auditExport: { ok: false, detail: "audit export contract exists, but approved Open Logs wiring and delivery smoke evidence are not proven" },
    deliveryAlarms: { ok: false, detail: "reporter lag, failed delivery, and retry-exhaustion alarms are not proven" },
    workerLiveness: { ok: false, detail: "live reporter worker leases, drain, and rollback evidence are not proven" },
  };
  if (!raw?.trim()) return missing;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return failPromotionEvidence("promotion evidence JSON could not be parsed");
  }
  const safety = sanitizeEvidenceInput(parsed, { source: "postgres-report-runtime-promotion-evidence" });
  if (safety.unsafe) return failPromotionEvidence(`promotion evidence failed no-secret review; findings=${safety.summary.findings}`);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return failPromotionEvidence("promotion evidence must be a JSON object");
  }
  const evidence = parsed as Partial<PostgresReportRuntimePromotionEvidence> & Record<string, unknown>;
  if (evidence.version !== "open-uptime.reporter-promotion-evidence.v1") {
    return failPromotionEvidence("promotion evidence version must be open-uptime.reporter-promotion-evidence.v1");
  }
  if (evidence.redacted !== true) return failPromotionEvidence("promotion evidence must declare redacted=true");
  if (evidence.workspaceId != null) {
    if (typeof evidence.workspaceId !== "string") return failPromotionEvidence("promotion evidence workspaceId must be a string");
    let evidenceWorkspaceId: string;
    try {
      evidenceWorkspaceId = normalizeWorkspaceId(evidence.workspaceId);
    } catch {
      return failPromotionEvidence("promotion evidence workspaceId must be a safe workspace id");
    }
    if (!workspaceId || evidenceWorkspaceId !== workspaceId) {
      return failPromotionEvidence("promotion evidence workspaceId does not match the active workspace");
    }
  }
  if (evidence.checkedAt != null) {
    try {
      normalizeIsoTimestamp(String(evidence.checkedAt), "promotion evidence checkedAt");
    } catch {
      return failPromotionEvidence("promotion evidence checkedAt must be an ISO timestamp");
    }
  }
  if (!evidence.checks || typeof evidence.checks !== "object" || Array.isArray(evidence.checks)) {
    return failPromotionEvidence("promotion evidence checks must be an object");
  }
  const checks = evidence.checks as PostgresReportRuntimePromotionEvidence["checks"];
  return {
    artifactObjectStore: artifactObjectStoreEvidenceResult(checks.artifactObjectStore),
    auditExport: auditExportEvidenceResult(checks.auditExport),
    deliveryAlarms: deliveryAlarmsEvidenceResult(checks.deliveryAlarms),
    workerLiveness: workerLivenessEvidenceResult(checks.workerLiveness),
  };
}

function failPromotionEvidence(detail: string): ReturnType<typeof parseReporterPromotionEvidence> {
  const safeDetail = sanitizePromotionDetail(detail);
  return {
    artifactObjectStore: { ok: false, detail: safeDetail },
    auditExport: { ok: false, detail: safeDetail },
    deliveryAlarms: { ok: false, detail: safeDetail },
    workerLiveness: { ok: false, detail: safeDetail },
  };
}

function artifactObjectStoreEvidenceResult(value: PostgresReportRuntimeArtifactObjectStoreEvidence | undefined): { ok: boolean; detail: string } {
  if (!value) return { ok: false, detail: "approved S3/object storage wiring evidence is missing" };
  const ok = value.ok === true
    && value.reviewed === true
    && value.smokePassed === true
    && value.encrypted === true
    && value.redactedOnly === true
    && value.workspaceScoped === true;
  return {
    ok,
    detail: ok
      ? sanitizePromotionDetail(value.detail ?? "approved redacted artifact object store smoke evidence is present")
      : "artifact object store evidence must prove review, smoke, encryption, redacted-only writes, and workspace scoping",
  };
}

function auditExportEvidenceResult(value: PostgresReportRuntimeAuditExportEvidence | undefined): { ok: boolean; detail: string } {
  if (!value) return { ok: false, detail: "approved Open Logs audit export evidence is missing" };
  const ok = value.ok === true
    && value.reviewed === true
    && value.smokePassed === true
    && value.redactedOnly === true
    && value.workspaceScoped === true
    && value.service === "logs";
  return {
    ok,
    detail: ok
      ? sanitizePromotionDetail(value.detail ?? "approved redacted Open Logs audit export smoke evidence is present")
      : "Open Logs audit export evidence must prove review, smoke, redacted-only payloads, workspace scoping, and service=logs",
  };
}

function deliveryAlarmsEvidenceResult(value: PostgresReportRuntimeDeliveryAlarmsEvidence | undefined): { ok: boolean; detail: string } {
  if (!value) return { ok: false, detail: "approved reporter delivery alarm evidence is missing" };
  const ok = value.ok === true
    && value.reviewed === true
    && Number.isInteger(value.alarmCount)
    && value.alarmCount >= 3
    && value.actionsConfigured === true
    && value.reporterMetricsReviewed === true;
  return {
    ok,
    detail: ok
      ? sanitizePromotionDetail(value.detail ?? `approved reporter delivery alarm evidence is present; alarmCount=${value.alarmCount}`)
      : "reporter delivery alarm evidence must prove review, at least three alarms, configured actions, and reporter metric review",
  };
}

function workerLivenessEvidenceResult(value: PostgresReportRuntimeWorkerLivenessEvidence | undefined): { ok: boolean; detail: string } {
  if (!value) return { ok: false, detail: "live reporter worker liveness evidence is missing" };
  const ok = value.ok === true
    && value.reviewed === true
    && Number.isInteger(value.sustainedRunSeconds)
    && value.sustainedRunSeconds >= 300
    && value.drainProven === true
    && value.rollbackProven === true;
  return {
    ok,
    detail: ok
      ? sanitizePromotionDetail(value.detail ?? `approved reporter liveness, drain, and rollback evidence is present; sustainedRunSeconds=${value.sustainedRunSeconds}`)
      : "reporter liveness evidence must prove review, at least 300 sustained seconds, deploy drain, and rollback",
  };
}

function sanitizePromotionDetail(value: string): string {
  const report = sanitizeEvidenceInput(value, { inputFormat: "text", source: "postgres-report-runtime-promotion-detail" });
  if (report.unsafe) return "redacted promotion evidence detail";
  return typeof report.sanitized === "string" && report.sanitized.trim()
    ? report.sanitized.trim().slice(0, 500)
    : "redacted promotion evidence detail";
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

function normalizeArtifactBody(value: PostgresReportArtifactBody): Uint8Array {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("report artifact body must be a string, Uint8Array, or JSON object");
  }
  return new TextEncoder().encode(JSON.stringify(value));
}

function assertSafeReportArtifactBody(body: Uint8Array): void {
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new Error("report artifact body must be UTF-8 text so it can be redaction-checked before object storage");
  }
  if (/\bhttps?:\/\/[^\s"'<>]+/i.test(decoded)) {
    throw new Error("report artifact body must not contain raw URLs; use hosted report redaction before writing artifacts");
  }
  if (/\b(?:[a-z0-9-]+\.)+[a-z]{2,}:\d{1,5}\b/i.test(decoded) || /\b(?:[a-z0-9-]+\.)+(?:internal|local)\b/i.test(decoded)) {
    throw new Error("report artifact body must not contain raw host targets; use hosted report redaction before writing artifacts");
  }
  const report = sanitizeEvidenceInput(decoded, { inputFormat: "auto", source: "postgres-report-artifact-body" });
  if (report.unsafe) {
    throw new Error(`report artifact body must be redacted before object storage; sanitizer findings=${report.summary.findings}`);
  }
}

function normalizeAuditMetadata(value: Record<string, unknown>): Record<string, unknown> {
  const report = sanitizeEvidenceInput(value, { source: "postgres-report-audit-metadata" });
  if (report.unsafe) throw new Error(`audit metadata must be redacted before export; sanitizer findings=${report.summary.findings}`);
  if (!report.sanitized || typeof report.sanitized !== "object" || Array.isArray(report.sanitized)) {
    throw new Error("audit metadata must be a JSON object");
  }
  return report.sanitized as Record<string, unknown>;
}

function sanitizeUnsafeAuditError(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "redacted audit error";
  try {
    const report = sanitizeEvidenceInput(trimmed, { inputFormat: "text", source: "postgres-report-audit-error" });
    return typeof report.sanitized === "string" ? report.sanitized : "redacted audit error";
  } catch {
    return "redacted audit error";
  }
}

function assertSafeAuditEvent(value: unknown): void {
  const report = sanitizeEvidenceInput(value, { source: "postgres-report-audit-event" });
  if (report.unsafe) throw new Error(`audit export payload must be redacted before export; sanitizer findings=${report.summary.findings}`);
}

function normalizeAuditStatus(value: string): PostgresReportAuditExportEvent["status"] {
  if (value === "succeeded" || value === "failed" || value === "retry_exhausted" || value === "artifact_written" || value === "artifact_failed") return value;
  throw new Error("audit status must be succeeded, failed, retry_exhausted, artifact_written, or artifact_failed");
}

function normalizeContentType(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*(?:;\s*charset=utf-8)?$/.test(trimmed)) {
    throw new Error("artifact content type must be a safe media type");
  }
  return trimmed;
}

function defaultArtifactContentType(value: PostgresReportArtifactType): string {
  if (value === "json") return "application/json";
  if (value === "html") return "text/html; charset=utf-8";
  if (value === "summary") return "text/plain; charset=utf-8";
  return "application/pdf";
}

function suggestedArtifactKey(workspaceId: string, reportRunId: string, artifactType: PostgresReportArtifactType, artifactSha256: string): string {
  return `reports/${sha256(workspaceId).slice(0, 16)}/${sha256(reportRunId).slice(0, 24)}/${artifactSha256}.${artifactType}`;
}

function resolveHostedHelperWorkspaceId(value: string | undefined, label: string): string {
  const resolved = value ?? process.env.HASNA_UPTIME_WORKSPACE_ID;
  if ((process.env.HASNA_UPTIME_MODE ?? "").trim() === "hosted" && !resolved) {
    throw new Error(`${label} requires workspaceId or HASNA_UPTIME_WORKSPACE_ID in hosted mode`);
  }
  return normalizeWorkspaceId(resolved ?? "default");
}

function artifactIdempotencyKey(workspaceId: string, reportRunId: string, artifactType: PostgresReportArtifactType, artifactSha256: string): string {
  return `sha256:${sha256([
    "open-uptime.report-artifact-object.v1",
    workspaceId,
    reportRunId,
    artifactType,
    artifactSha256,
  ].join("\u001f"))}`;
}

function normalizeArtifactIdempotencyKey(
  value: string | null | undefined,
  workspaceId: string,
  reportRunId: string,
  artifactType: PostgresReportArtifactType,
  artifactSha256: string,
): string {
  const expected = artifactIdempotencyKey(workspaceId, reportRunId, artifactType, artifactSha256);
  if (value == null || value.trim() === "") return expected;
  const normalized = normalizeOpaqueText(value, "artifact idempotency key", 256);
  if (normalized !== expected) throw new Error("artifact idempotency key must match artifact bytes");
  return normalized;
}

function auditEventIdempotencyKey(value: Omit<PostgresReportAuditExportEvent, "eventId" | "idempotencyKey">): string {
  return `raeik_${sha256(JSON.stringify(value))}`;
}

function normalizeAuditIdempotencyKey(value: string | null | undefined, event: Omit<PostgresReportAuditExportEvent, "eventId" | "idempotencyKey">): string {
  const expected = auditEventIdempotencyKey(event);
  if (value == null || value.trim() === "") return expected;
  const normalized = normalizeOpaqueText(value, "audit idempotency key", 256);
  if (normalized !== expected) throw new Error("audit idempotency key must match the redacted audit event");
  return normalized;
}

function stripSha256Prefix(value: string | null | undefined): string | null | undefined {
  if (value == null) return value;
  return value.trim().replace(/^sha256:/i, "");
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

function normalizeProviderEvidenceId(value: string, label: string, maxLength: number): string {
  const ref = normalizeRuntimeRefId(value, label, maxLength);
  const report = sanitizeEvidenceInput(ref, { inputFormat: "text", source: label });
  if (report.unsafe) throw new Error(`${label} must be redacted before storage`);
  return ref;
}

function normalizeNullableProviderEvidenceId(value: string | null | undefined, label: string, maxLength: number): string | null {
  if (value == null || value.trim() === "") return null;
  return normalizeProviderEvidenceId(value, label, maxLength);
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

function sha256Bytes(value: Uint8Array): string {
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
