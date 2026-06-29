import { expect, test } from "bun:test";
import {
  buildPostgresReportRuntimeReadiness,
  createPostgresReportRuntime,
  deliveryAttemptIdempotencyKey,
  sanitizePostgresReportRuntimeError,
  type PostgresReportArtifactRecord,
  type PostgresReportDeliveryAttemptRecord,
  type PostgresReportRunRecord,
} from "../src/postgres-report-runtime.js";
import type { PostgresQueryClient } from "../src/postgres.js";

class FakeReportClient implements PostgresQueryClient {
  readonly queries: Array<{ sql: string; params?: unknown[] }> = [];
  deliveryAttempt: PostgresReportDeliveryAttemptRecord | null = null;
  releaseCount = 0;

  async query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }> {
    this.queries.push({ sql, params });
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK" || sql.includes("set_config('app.workspace_id'")) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("INSERT INTO \"uptime\".\"report_runs\"")) {
      const row: PostgresReportRunRecord = {
        workspaceId: String(params?.[0]),
        id: String(params?.[1]),
        scheduleId: params?.[2] == null ? null : String(params[2]),
        status: params?.[3] as PostgresReportRunRecord["status"],
        startedAt: String(params?.[4]),
        finishedAt: String(params?.[5]),
        deliveries: JSON.parse(String(params?.[6])),
        error: params?.[7] == null ? null : String(params[7]),
        reportJson: params?.[8] == null ? null : JSON.parse(String(params[8])),
        artifactRef: params?.[9] == null ? null : String(params[9]),
        actor: params?.[10] == null ? null : String(params[10]),
        origin: params?.[11] == null ? null : String(params[11]),
        idempotencyKey: params?.[12] == null ? null : String(params[12]),
      };
      return { rows: [snakeReportRun(row)], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO \"uptime\".\"report_delivery_attempts\"")) {
      this.deliveryAttempt = {
        workspaceId: String(params?.[0]),
        id: String(params?.[1]),
        reportRunId: String(params?.[2]),
        channel: params?.[3] as PostgresReportDeliveryAttemptRecord["channel"],
        channelRefId: String(params?.[4]),
        provider: String(params?.[5]),
        attemptNumber: Number(params?.[6]),
        status: params?.[7] as PostgresReportDeliveryAttemptRecord["status"],
        idempotencyKey: String(params?.[8]),
        scheduledAt: String(params?.[9]),
        startedAt: null,
        finishedAt: null,
        nextRetryAt: params?.[10] == null ? null : String(params[10]),
        responseStatus: params?.[11] == null ? null : Number(params[11]),
        providerMessageId: params?.[12] == null ? null : String(params[12]),
        error: params?.[13] == null ? null : String(params[13]),
        retryAfterSeconds: params?.[14] == null ? null : Number(params[14]),
        requestHash: params?.[15] == null ? null : String(params[15]),
        responseHash: params?.[16] == null ? null : String(params[16]),
        claimedByWorkerId: null,
        fencingToken: null,
        leaseExpiresAt: null,
        version: 1,
      };
      return { rows: [snakeDeliveryAttempt(this.deliveryAttempt)], rowCount: 1 };
    }
    if (sql.includes("SELECT * FROM \"uptime\".\"report_delivery_attempts\"")) {
      return { rows: this.deliveryAttempt ? [snakeDeliveryAttempt(this.deliveryAttempt)] : [], rowCount: this.deliveryAttempt ? 1 : 0 };
    }
    if (sql.includes("UPDATE \"uptime\".\"report_delivery_attempts\"") && sql.includes("claimed_by_worker_id = $3")) {
      if (!this.deliveryAttempt) return { rows: [], rowCount: 0 };
      this.deliveryAttempt = {
        ...this.deliveryAttempt,
        status: "sending",
        claimedByWorkerId: String(params?.[2]),
        fencingToken: String(params?.[3]),
        startedAt: "2026-06-29T08:02:00.000Z",
        leaseExpiresAt: "2026-06-29T08:03:00.000Z",
        version: this.deliveryAttempt.version + 1,
      };
      return { rows: [snakeDeliveryAttempt(this.deliveryAttempt)], rowCount: 1 };
    }
    if (sql.includes("UPDATE \"uptime\".\"report_delivery_attempts\"") && sql.includes("finished_at")) {
      if (!this.deliveryAttempt) return { rows: [], rowCount: 0 };
      if (this.deliveryAttempt.status !== "sending" || !this.deliveryAttempt.leaseExpiresAt) return { rows: [], rowCount: 0 };
      this.deliveryAttempt = {
        ...this.deliveryAttempt,
        status: params?.[2] as PostgresReportDeliveryAttemptRecord["status"],
        finishedAt: String(params?.[3]),
        nextRetryAt: params?.[4] == null ? null : String(params[4]),
        responseStatus: params?.[5] == null ? null : Number(params[5]),
        providerMessageId: params?.[6] == null ? null : String(params[6]),
        error: params?.[7] == null ? null : String(params[7]),
        retryAfterSeconds: params?.[8] == null ? null : Number(params[8]),
        responseHash: params?.[9] == null ? null : String(params[9]),
        leaseExpiresAt: null,
        fencingToken: null,
        version: this.deliveryAttempt.version + 1,
      };
      return { rows: [snakeDeliveryAttempt(this.deliveryAttempt)], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO \"uptime\".\"report_artifacts\"")) {
      const row: PostgresReportArtifactRecord = {
        workspaceId: String(params?.[0]),
        id: String(params?.[1]),
        reportRunId: String(params?.[2]),
        artifactType: params?.[3] as PostgresReportArtifactRecord["artifactType"],
        storageRef: String(params?.[4]),
        sha256: String(params?.[5]),
        byteSize: Number(params?.[6]),
        redacted: Boolean(params?.[7]),
        retentionClass: params?.[8] as PostgresReportArtifactRecord["retentionClass"],
        kmsKeyRef: params?.[9] == null ? null : String(params[9]),
        actor: params?.[10] == null ? null : String(params[10]),
        origin: params?.[11] == null ? null : String(params[11]),
        idempotencyKey: params?.[12] == null ? null : String(params[12]),
      };
      return { rows: [snakeArtifact(row)], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  async connect(): Promise<FakeReportClient> {
    return this;
  }

  release(): void {
    this.releaseCount += 1;
  }
}

test("Postgres report runtime records report runs, attempts, claims, completions, and artifact metadata", async () => {
  const client = new FakeReportClient();
  const runtime = createPostgresReportRuntime({
    client,
    workspaceId: "ws_runtime",
    now: () => new Date("2026-06-29T08:00:00.000Z"),
  });

  const run = await runtime.recordReportRun({
    id: "rpr_runtime",
    scheduleId: "rps_daily",
    status: "success",
    deliveries: [{ channel: "email", ok: true, id: "message_123" }],
    reportJson: { kind: "open-uptime.report", totals: { down: 0 } },
    artifactRef: "artifact://reports/rpr_runtime.json",
    actor: "reporter",
  });
  const attempt = await runtime.createDeliveryAttempt({
    reportRunId: run.id,
    channel: "email",
    channelRefId: "ops-email",
    provider: "mailery",
    requestHash: "a".repeat(64),
  });
  const due = await runtime.listDueDeliveryAttempts({ now: "2026-06-29T08:01:00.000Z" });
  const claimed = await runtime.claimDeliveryAttempt({
    id: attempt.id,
    workerId: "reporter-1",
    leaseTtlMs: 60_000,
  });
  const completed = await runtime.completeDeliveryAttempt({
    id: attempt.id,
    fencingToken: claimed!.fencingToken!,
    status: "succeeded",
    responseStatus: 202,
    providerMessageId: "msg_202",
    responseHash: "b".repeat(64),
  });
  const artifact = await runtime.recordArtifact({
    reportRunId: run.id,
    artifactType: "json",
    storageRef: "s3://open-uptime-artifacts/reports/rpr_runtime.json",
    sha256: "c".repeat(64),
    byteSize: 512,
    kmsKeyRef: "kms-key-ref",
  });

  expect(run.workspaceId).toBe("ws_runtime");
  expect(run.reportJson).toEqual({
    kind: "open-uptime.report-json-metadata",
    sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    redacted: true,
    storage: "artifact-required",
  });
  expect(attempt.idempotencyKey).toBe(deliveryAttemptIdempotencyKey("ws_runtime", run.id, "email", "ops-email", 1, "2026-06-29T08:00:00.000Z"));
  expect(due).toHaveLength(1);
  expect(claimed?.status).toBe("sending");
  expect(claimed?.claimedByWorkerId).toBe("reporter-1");
  expect(completed?.status).toBe("succeeded");
  expect(completed?.responseStatus).toBe(202);
  expect(completed?.fencingToken).toBeNull();
  expect(await runtime.completeDeliveryAttempt({
    id: attempt.id,
    fencingToken: claimed!.fencingToken!,
    status: "failed",
  })).toBeNull();
  expect(artifact.retentionClass).toBe("standard");
  expect(artifact.redacted).toBe(true);
  expect(client.queries.map((query) => query.sql).filter((sql) => sql === "BEGIN")).toHaveLength(7);
  expect(client.queries.some((query) => query.sql.includes("set_config('app.workspace_id'"))).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("lease_expires_at = now() + ($5::bigint * interval '1 millisecond')"))).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("status = 'sending' AND lease_expires_at <= now()"))).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("status = 'sending' AND lease_expires_at <= $2::timestamptz"))).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("AND fencing_token = $11"))).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("AND status = 'sending'"))).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("AND lease_expires_at > now()"))).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("IS NOT DISTINCT FROM EXCLUDED.report_json"))).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("IS NOT DISTINCT FROM EXCLUDED.request_hash"))).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("ON CONFLICT (workspace_id, idempotency_key)"))).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("fencing_token"))).toBe(true);
  expect(client.releaseCount).toBeGreaterThan(0);
});

test("Postgres report runtime redacts stale fencing tokens from due discovery", async () => {
  const client = new FakeReportClient();
  const runtime = createPostgresReportRuntime({
    client,
    workspaceId: "ws_runtime",
    now: () => new Date("2026-06-29T08:00:00.000Z"),
  });
  await runtime.createDeliveryAttempt({
    reportRunId: "rpr_runtime",
    channel: "logs",
    channelRefId: "ops-logs",
    provider: "logs",
  });
  const claimed = await runtime.claimDeliveryAttempt({
    id: client.deliveryAttempt!.id,
    workerId: "reporter-1",
    leaseTtlMs: 1_000,
  });
  client.deliveryAttempt = {
    ...client.deliveryAttempt!,
    status: "sending",
    fencingToken: claimed!.fencingToken,
    leaseExpiresAt: "2026-06-29T08:01:01.000Z",
  };

  const due = await runtime.listDueDeliveryAttempts({ now: "2026-06-29T08:02:00.000Z" });

  expect(due).toHaveLength(1);
  expect(due[0]!.status).toBe("sending");
  expect(due[0]!.fencingToken).toBeNull();
});

test("Postgres report runtime rejects local artifacts and secret-looking refs", async () => {
  const runtime = createPostgresReportRuntime({ client: new FakeReportClient(), workspaceId: "ws_runtime" });

  await expect(runtime.recordArtifact({
    reportRunId: "rpr_runtime",
    artifactType: "json",
    storageRef: "file:///tmp/raw.json",
    sha256: "c".repeat(64),
    byteSize: 10,
  })).rejects.toThrow("s3:// or artifact://");

  await expect(runtime.createDeliveryAttempt({
    reportRunId: "rpr_runtime",
    channel: "logs",
    channelRefId: "token=raw-secret",
    provider: "logs",
  })).rejects.toThrow("opaque reference");

  await expect(runtime.createDeliveryAttempt({
    reportRunId: "rpr_runtime",
    channel: "email",
    channelRefId: "ops@example.com",
    provider: "mailery",
  })).rejects.toThrow("raw email");

  await expect(runtime.createDeliveryAttempt({
    reportRunId: "rpr_runtime",
    channel: "sms",
    channelRefId: "+15550101010",
    provider: "telephony",
  })).rejects.toThrow("raw phone");

  await expect(runtime.createDeliveryAttempt({
    reportRunId: "rpr_runtime",
    channel: "logs",
    channelRefId: "ops-logs",
    provider: "https://logs.example",
  })).rejects.toThrow("provider must be");

  await expect(runtime.recordArtifact({
    reportRunId: "rpr_runtime",
    artifactType: "json",
    storageRef: "s3://open-uptime-artifacts/reports/raw.json",
    sha256: "c".repeat(64),
    byteSize: 10,
    redacted: false,
  })).rejects.toThrow("must be redacted");
});

test("Postgres report runtime readiness is honest about schema verification", () => {
  const readiness = buildPostgresReportRuntimeReadiness({
    databaseUrl: "postgres://svc:raw-password@db.example.invalid/uptime?sslmode=require",
    workspaceId: "ws_runtime",
  });
  const checks = Object.fromEntries(readiness.checks.map((check) => [check.name, check.ok]));
  const serialized = JSON.stringify(readiness);

  expect(readiness.status).toBe("blocked");
  expect(readiness.canWriteReportMetadata).toBe(false);
  expect(checks["report-run-metadata-writer"]).toBe(true);
  expect(checks["report-delivery-attempt-state"]).toBe(true);
  expect(checks["report-delivery-idempotency"]).toBe(true);
  expect(checks["report-artifact-metadata-writer"]).toBe(true);
  expect(checks["report-runtime-schema-verified"]).toBe(false);
  expect(readiness.database.redactedUrl).toBe("postgres://user:redacted@db.example.invalid/uptime");
  expect(serialized).not.toContain("raw-password");
  expect(serialized).not.toContain("sslmode=require");
});

test("Postgres report runtime readiness can be marked ready only with schema evidence", () => {
  const readiness = buildPostgresReportRuntimeReadiness({
    databaseUrl: "postgres://svc:secret@db.example.invalid/uptime?sslmode=require",
    workspaceId: "ws_runtime",
    schemaVerified: true,
  });

  expect(readiness.status).toBe("ready");
  expect(readiness.canWriteReportMetadata).toBe(true);
  expect(readiness.blockers).toEqual([]);
});

test("Postgres report runtime sanitizes database URLs and bearer material in errors", () => {
  const message = sanitizePostgresReportRuntimeError(
    new Error("failed postgres://svc:raw-password@db.invalid/app?sslmode=require token=raw-token Bearer raw-bearer"),
    "postgres://svc:raw-password@db.invalid/app?sslmode=require",
  );

  expect(message).toContain("postgres://user:redacted@db.invalid/app");
  expect(message).toContain("token=redacted");
  expect(sanitizePostgresReportRuntimeError("jwt=raw-jwt code=raw-code session=raw-session key=raw-key"))
    .toBe("jwt=redacted code=redacted session=redacted key=redacted");
  expect(message).toContain("Bearer redacted");
  expect(message).not.toContain("raw-password");
  expect(message).not.toContain("raw-token");
  expect(message).not.toContain("raw-bearer");
  expect(message).not.toContain("sslmode=require");
});

function snakeReportRun(row: PostgresReportRunRecord): Record<string, unknown> {
  return {
    workspace_id: row.workspaceId,
    id: row.id,
    schedule_id: row.scheduleId,
    status: row.status,
    started_at: row.startedAt,
    finished_at: row.finishedAt,
    deliveries_json: JSON.stringify(row.deliveries),
    error: row.error,
    report_json: row.reportJson ? JSON.stringify(row.reportJson) : null,
    artifact_ref: row.artifactRef,
    actor: row.actor,
    origin: row.origin,
    idempotency_key: row.idempotencyKey,
  };
}

function snakeDeliveryAttempt(row: PostgresReportDeliveryAttemptRecord): Record<string, unknown> {
  return {
    workspace_id: row.workspaceId,
    id: row.id,
    report_run_id: row.reportRunId,
    channel: row.channel,
    channel_ref_id: row.channelRefId,
    provider: row.provider,
    attempt_number: row.attemptNumber,
    status: row.status,
    idempotency_key: row.idempotencyKey,
    scheduled_at: row.scheduledAt,
    started_at: row.startedAt,
    finished_at: row.finishedAt,
    next_retry_at: row.nextRetryAt,
    response_status: row.responseStatus,
    provider_message_id: row.providerMessageId,
    error: row.error,
    retry_after_seconds: row.retryAfterSeconds,
    request_hash: row.requestHash,
    response_hash: row.responseHash,
    claimed_by_worker_id: row.claimedByWorkerId,
    fencing_token: row.fencingToken,
    lease_expires_at: row.leaseExpiresAt,
    version: row.version,
  };
}

function snakeArtifact(row: PostgresReportArtifactRecord): Record<string, unknown> {
  return {
    workspace_id: row.workspaceId,
    id: row.id,
    report_run_id: row.reportRunId,
    artifact_type: row.artifactType,
    storage_ref: row.storageRef,
    sha256: row.sha256,
    byte_size: row.byteSize,
    redacted: row.redacted,
    retention_class: row.retentionClass,
    kms_key_ref: row.kmsKeyRef,
    actor: row.actor,
    origin: row.origin,
    idempotency_key: row.idempotencyKey,
  };
}
