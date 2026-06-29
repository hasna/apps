import { expect, test } from "bun:test";
import {
  buildPostgresReportRuntimeReadiness,
  createPostgresReportRuntime,
  deliveryAttemptIdempotencyKey,
  sanitizePostgresReportRuntimeError,
  type PostgresReportArtifactRecord,
  type PostgresReportDeliveryAttemptRecord,
  type PostgresReportRunRecord,
  type PostgresReportScheduleClaimRecord,
} from "../src/postgres-report-runtime.js";
import type { PostgresQueryClient } from "../src/postgres.js";

class FakeReportClient implements PostgresQueryClient {
  readonly queries: Array<{ sql: string; params?: unknown[] }> = [];
  now = "2026-06-29T08:05:00.000Z";
  schedule: PostgresReportScheduleClaimRecord | null = null;
  rawScheduleChannels: unknown | null = null;
  reportRun: PostgresReportRunRecord | null = null;
  deliveryAttempt: PostgresReportDeliveryAttemptRecord | null = null;
  releaseCount = 0;

  async query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }> {
    this.queries.push({ sql, params });
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK" || sql.includes("set_config(")) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("INSERT INTO \"uptime\".\"report_runs\"")) {
      if (sql.includes("'running', $4::timestamptz")) {
        const existingVersion = this.reportRun?.id === String(params?.[1]) ? this.reportRun.version : 0;
        this.reportRun = {
          workspaceId: String(params?.[0]),
          id: String(params?.[1]),
          scheduleId: params?.[2] == null ? null : String(params[2]),
          status: "running",
          startedAt: String(params?.[3]),
          finishedAt: null,
          deliveries: [],
          error: null,
          reportJson: null,
          artifactRef: null,
          actor: params?.[4] == null ? null : String(params[4]),
          origin: params?.[5] == null ? null : String(params[5]),
          idempotencyKey: params?.[6] == null ? null : String(params[6]),
          claimedByWorkerId: params?.[7] == null ? null : String(params[7]),
          fencingToken: params?.[8] == null ? null : String(params[8]),
          leaseExpiresAt: addMillis(this.now, Number(params?.[9])),
          version: existingVersion + 1,
        };
        return { rows: [snakeReportRun(this.reportRun)], rowCount: 1 };
      }
      const status = params?.[3] === "success" ? "succeeded" : params?.[3] as PostgresReportRunRecord["status"];
      this.reportRun = {
        workspaceId: String(params?.[0]),
        id: String(params?.[1]),
        scheduleId: params?.[2] == null ? null : String(params[2]),
        status,
        startedAt: String(params?.[4]),
        finishedAt: params?.[5] == null ? null : String(params[5]),
        deliveries: JSON.parse(String(params?.[6])),
        error: params?.[7] == null ? null : String(params[7]),
        reportJson: params?.[8] == null ? null : JSON.parse(String(params[8])),
        artifactRef: params?.[9] == null ? null : String(params[9]),
        actor: params?.[10] == null ? null : String(params[10]),
        origin: params?.[11] == null ? null : String(params[11]),
        idempotencyKey: params?.[12] == null ? null : String(params[12]),
        claimedByWorkerId: null,
        fencingToken: null,
        leaseExpiresAt: null,
        version: 1,
      };
      return { rows: [snakeReportRun(this.reportRun)], rowCount: 1 };
    }
    if (sql.includes("SELECT * FROM \"uptime\".\"report_schedules\"")) {
      if (!this.schedule) return { rows: [], rowCount: 0 };
      if (sql.includes("FOR UPDATE")) {
        const claimMatches = this.schedule.workspaceId === String(params?.[0])
          && this.schedule.id === String(params?.[1])
          && this.schedule.enabled
          && this.schedule.claimedByWorkerId === String(params?.[2])
          && this.schedule.fencingToken === String(params?.[3])
          && Boolean(this.schedule.leaseExpiresAt)
          && this.schedule.leaseExpiresAt! > this.now;
        return { rows: claimMatches ? [this.snakeSchedule()] : [], rowCount: claimMatches ? 1 : 0 };
      }
      const due = this.schedule.enabled && this.schedule.nextRunAt <= String(params?.[1]);
      const leaseExpired = !this.schedule.fencingToken || !this.schedule.leaseExpiresAt || this.schedule.leaseExpiresAt <= String(params?.[1]);
      return { rows: due && leaseExpired ? [this.snakeSchedule()] : [], rowCount: due && leaseExpired ? 1 : 0 };
    }
    if (sql.includes("UPDATE \"uptime\".\"report_runs\"") && sql.includes("SET status = 'running'")) {
      if (!this.reportRun) return { rows: [], rowCount: 0 };
      const expired = !this.reportRun.leaseExpiresAt || this.reportRun.leaseExpiresAt <= this.now;
      if (this.reportRun.workspaceId !== String(params?.[0]) || this.reportRun.id !== String(params?.[1])) return { rows: [], rowCount: 0 };
      if (this.reportRun.status !== "pending" && !(this.reportRun.status === "running" && expired)) return { rows: [], rowCount: 0 };
      this.reportRun = {
        ...this.reportRun,
        status: "running",
        claimedByWorkerId: String(params?.[2]),
        fencingToken: String(params?.[3]),
        leaseExpiresAt: addMillis(this.now, Number(params?.[4])),
        version: this.reportRun.version + 1,
      };
      return { rows: [snakeReportRun(this.reportRun)], rowCount: 1 };
    }
    if (sql.includes("UPDATE \"uptime\".\"report_runs\"") && sql.includes("AND schedule_id = $9")) {
      if (!this.reportRun) return { rows: [], rowCount: 0 };
      const claimMatches = this.reportRun.workspaceId === String(params?.[0])
        && this.reportRun.id === String(params?.[1])
        && this.reportRun.scheduleId === String(params?.[8])
        && this.reportRun.startedAt === String(params?.[9])
        && this.reportRun.status === "running"
        && this.reportRun.claimedByWorkerId === String(params?.[10])
        && this.reportRun.fencingToken === String(params?.[11])
        && Boolean(this.reportRun.leaseExpiresAt)
        && this.reportRun.leaseExpiresAt! > this.now;
      if (!claimMatches) return { rows: [], rowCount: 0 };
      this.reportRun = {
        ...this.reportRun,
        status: params?.[2] as PostgresReportRunRecord["status"],
        finishedAt: String(params?.[3]),
        deliveries: JSON.parse(String(params?.[4])),
        error: params?.[5] == null ? null : String(params[5]),
        reportJson: params?.[6] == null ? null : JSON.parse(String(params[6])),
        artifactRef: params?.[7] == null ? null : String(params[7]),
        claimedByWorkerId: null,
        fencingToken: null,
        leaseExpiresAt: null,
        version: this.reportRun.version + 1,
      };
      return { rows: [snakeReportRun(this.reportRun)], rowCount: 1 };
    }
    if (sql.includes("UPDATE \"uptime\".\"report_runs\"") && sql.includes("finished_at = $4::timestamptz")) {
      if (!this.reportRun) return { rows: [], rowCount: 0 };
      const claimMatches = this.reportRun.workspaceId === String(params?.[0])
        && this.reportRun.id === String(params?.[1])
        && this.reportRun.status === "running"
        && this.reportRun.claimedByWorkerId === String(params?.[8])
        && this.reportRun.fencingToken === String(params?.[9])
        && Boolean(this.reportRun.leaseExpiresAt)
        && this.reportRun.leaseExpiresAt! > this.now;
      if (!claimMatches) return { rows: [], rowCount: 0 };
      this.reportRun = {
        ...this.reportRun,
        status: params?.[2] as PostgresReportRunRecord["status"],
        finishedAt: String(params?.[3]),
        deliveries: JSON.parse(String(params?.[4])),
        error: params?.[5] == null ? null : String(params[5]),
        reportJson: params?.[6] == null ? null : JSON.parse(String(params[6])),
        artifactRef: params?.[7] == null ? null : String(params[7]),
        claimedByWorkerId: null,
        fencingToken: null,
        leaseExpiresAt: null,
        version: this.reportRun.version + 1,
      };
      return { rows: [snakeReportRun(this.reportRun)], rowCount: 1 };
    }
    if (sql.includes("UPDATE \"uptime\".\"report_schedules\"") && sql.includes("SET claimed_by_worker_id = $3")) {
      if (!this.schedule) return { rows: [], rowCount: 0 };
      const now = this.now;
      const due = this.schedule.enabled && this.schedule.nextRunAt <= now;
      const leaseExpired = !this.schedule.fencingToken || !this.schedule.leaseExpiresAt || this.schedule.leaseExpiresAt <= now;
      if (!due || !leaseExpired) return { rows: [], rowCount: 0 };
      this.schedule = {
        ...this.schedule,
        claimedByWorkerId: String(params?.[2]),
        fencingToken: String(params?.[3]),
        leaseExpiresAt: new Date(new Date(now).getTime() + Number(params?.[4])).toISOString(),
        version: this.schedule.version + 1,
      };
      return { rows: [this.snakeSchedule()], rowCount: 1 };
    }
    if (sql.includes("UPDATE \"uptime\".\"report_schedules\"") && sql.includes("claimed_by_worker_id = NULL")) {
      if (!this.schedule) return { rows: [], rowCount: 0 };
      if (!this.schedule.leaseExpiresAt || this.schedule.leaseExpiresAt <= this.now) {
        return { rows: [], rowCount: 0 };
      }
      if (this.schedule.claimedByWorkerId !== String(params?.[2]) || this.schedule.fencingToken !== String(params?.[3])) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("AND report_schedule.next_run_at = $5::timestamptz") && this.schedule.nextRunAt !== String(params?.[4])) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("AND EXISTS")) {
        const terminalRunExists = this.reportRun?.scheduleId === this.schedule.id
          && this.reportRun.startedAt === this.schedule.nextRunAt
          && isTerminalReportRunStatus(this.reportRun.status);
        if (!terminalRunExists) return { rows: [], rowCount: 0 };
      }
      const nextRunAt = new Date(new Date(this.schedule.nextRunAt).getTime() + this.schedule.intervalSeconds * 1000).toISOString();
      this.schedule = {
        ...this.schedule,
        lastRunAt: this.schedule.nextRunAt,
        nextRunAt,
        claimedByWorkerId: null,
        fencingToken: null,
        leaseExpiresAt: null,
        version: this.schedule.version + 1,
      };
      return { rows: [this.snakeSchedule()], rowCount: 1 };
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
        claimedByWorkerId: null,
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

  private snakeSchedule(): Record<string, unknown> {
    const row = snakeSchedule(this.schedule!);
    if (this.rawScheduleChannels != null) {
      row.channels_json = JSON.stringify(this.rawScheduleChannels);
    }
    return row;
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
  expect(run.status).toBe("succeeded");
  expect(run.finishedAt).toBe("2026-06-29T08:00:00.000Z");
  expect(run.claimedByWorkerId).toBeNull();
  expect(run.fencingToken).toBeNull();
  expect(run.leaseExpiresAt).toBeNull();
  expect(run.version).toBe(1);
  expect(run.reportJson).toEqual({
    kind: "open-uptime.report-json-metadata",
    sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    redacted: true,
    storage: "artifact-required",
  });
  expect(attempt.idempotencyKey).toBe(deliveryAttemptIdempotencyKey("ws_runtime", run.id, "email", "ops-email", 1));
  expect(due).toHaveLength(1);
  expect(claimed?.status).toBe("sending");
  expect(claimed?.claimedByWorkerId).toBe("reporter-1");
  expect(completed?.status).toBe("succeeded");
  expect(completed?.responseStatus).toBe(202);
  expect(completed?.claimedByWorkerId).toBeNull();
  expect(completed?.fencingToken).toBeNull();
  expect(await runtime.completeDeliveryAttempt({
    id: attempt.id,
    fencingToken: claimed!.fencingToken!,
    status: "retry_exhausted",
  })).toBeNull();
  expect(artifact.retentionClass).toBe("standard");
  expect(artifact.redacted).toBe(true);
  expect(client.queries.map((query) => query.sql).filter((sql) => sql === "BEGIN")).toHaveLength(7);
  expect(client.queries.some((query) => query.sql.includes("set_config($1, $2, true)") && query.params?.[0] === "app.workspace_id")).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("lease_expires_at = now() + ($5::bigint * interval '1 millisecond')"))).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("status = 'sending' AND lease_expires_at <= now()"))).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("status = 'sending' AND lease_expires_at <= $2::timestamptz"))).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("AND fencing_token = $11"))).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("AND status = 'sending'"))).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("AND lease_expires_at > now()"))).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("IS NOT DISTINCT FROM EXCLUDED.report_json"))).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("IS NOT DISTINCT FROM EXCLUDED.request_hash"))).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("scheduled_at IS NOT DISTINCT FROM EXCLUDED.scheduled_at"))).toBe(false);
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

test("Postgres report runtime requires retry metadata for failed delivery attempts", async () => {
  const client = new FakeReportClient();
  const runtime = createPostgresReportRuntime({
    client,
    workspaceId: "ws_runtime",
    now: () => new Date("2026-06-29T08:00:00.000Z"),
  });
  const attempt = await runtime.createDeliveryAttempt({
    reportRunId: "rpr_runtime",
    channel: "logs",
    channelRefId: "ops-logs",
    provider: "logs",
  });
  const claimed = await runtime.claimDeliveryAttempt({
    id: attempt.id,
    workerId: "reporter-1",
    leaseTtlMs: 60_000,
  });

  await expect(runtime.completeDeliveryAttempt({
    id: attempt.id,
    fencingToken: claimed!.fencingToken!,
    status: "failed",
  })).rejects.toThrow("nextRetryAt");

  const completed = await runtime.completeDeliveryAttempt({
    id: attempt.id,
    fencingToken: claimed!.fencingToken!,
    status: "failed",
    nextRetryAt: "2026-06-29T08:10:00.000Z",
    error: "temporary provider failure",
  });

  expect(completed?.status).toBe("failed");
  expect(completed?.nextRetryAt).toBe("2026-06-29T08:10:00.000Z");
  expect(completed?.claimedByWorkerId).toBeNull();
});

test("Postgres report runtime claims due report schedule windows with fencing", async () => {
  const client = new FakeReportClient();
  client.schedule = {
    workspaceId: "ws_runtime",
    id: "rps_daily",
    name: "daily",
    enabled: true,
    intervalSeconds: 3600,
    nextRunAt: "2026-06-29T08:00:00.000Z",
    lastRunAt: null,
    subject: "Daily uptime",
    channels: { email: false, sms: false, logs: true },
    claimedByWorkerId: null,
    fencingToken: null,
    leaseExpiresAt: null,
    version: 1,
  };
  const runtime = createPostgresReportRuntime({
    client,
    workspaceId: "ws_runtime",
    now: () => new Date("2026-06-29T08:05:00.000Z"),
  });

  const due = await runtime.listDueReportSchedules({ now: "2026-06-29T08:05:00.000Z" });
  const claimed = await runtime.claimReportSchedule({
    id: "rps_daily",
    workerId: "reporter-1",
    now: "2026-06-29T08:05:00.000Z",
    leaseTtlMs: 60_000,
  });
  const blockedWhileLeased = await runtime.claimReportSchedule({
    id: "rps_daily",
    workerId: "reporter-2",
    now: "2026-06-29T08:05:30.000Z",
    leaseTtlMs: 60_000,
  });
  const badComplete = await runtime.completeReportScheduleClaim({
    id: "rps_daily",
    workerId: "reporter-2",
    fencingToken: claimed!.fencingToken!,
    finishedAt: "2026-06-29T08:05:30.000Z",
  });
  const prematureComplete = await runtime.completeReportScheduleClaim({
    id: "rps_daily",
    workerId: "reporter-1",
    fencingToken: claimed!.fencingToken!,
    finishedAt: "2026-06-29T08:05:30.000Z",
  });
  const reportRun = await runtime.beginReportRunForScheduleClaim({
    scheduleId: "rps_daily",
    workerId: "reporter-1",
    scheduleFencingToken: claimed!.fencingToken!,
    leaseTtlMs: 60_000,
    actor: "reporter",
  });
  const wrongFinish = await runtime.finishReportRunForScheduleClaim({
    scheduleId: "rps_daily",
    workerId: "reporter-2",
    scheduleFencingToken: claimed!.fencingToken!,
    reportRunFencingToken: reportRun!.fencingToken!,
    status: "succeeded",
  });
  const finished = await runtime.finishReportRunForScheduleClaim({
    scheduleId: "rps_daily",
    workerId: "reporter-1",
    scheduleFencingToken: claimed!.fencingToken!,
    reportRunFencingToken: reportRun!.fencingToken!,
    status: "succeeded",
    deliveries: [{ channel: "logs", ok: true, id: "log_123" }],
    reportJson: { totals: { down: 0 } },
    artifactRef: "artifact://reports/rps_daily/2026-06-29T08:00:00.000Z.json",
  });
  const completed = finished?.schedule;

  expect(due).toHaveLength(1);
  expect(due[0]!.fencingToken).toBeNull();
  expect(due[0]!.channels).toEqual({ email: false, sms: false, logs: true });
  expect(claimed?.lastRunAt).toBeNull();
  expect(claimed?.nextRunAt).toBe("2026-06-29T08:00:00.000Z");
  expect(claimed?.claimedByWorkerId).toBe("reporter-1");
  expect(claimed?.fencingToken).toMatch(/^rsf_/);
  expect(claimed?.leaseExpiresAt).toBe("2026-06-29T08:06:00.000Z");
  expect(blockedWhileLeased).toBeNull();
  expect(badComplete).toBeNull();
  expect(prematureComplete).toBeNull();
  expect(reportRun?.status).toBe("running");
  expect(reportRun?.startedAt).toBe("2026-06-29T08:00:00.000Z");
  expect(reportRun?.claimedByWorkerId).toBe("reporter-1");
  expect(reportRun?.fencingToken).toMatch(/^rrf_/);
  expect(wrongFinish).toBeNull();
  expect(finished?.reportRun.status).toBe("succeeded");
  expect(finished?.reportRun.finishedAt).toBe("2026-06-29T08:05:00.000Z");
  expect(finished?.reportRun.claimedByWorkerId).toBeNull();
  expect(completed?.lastRunAt).toBe("2026-06-29T08:00:00.000Z");
  expect(completed?.nextRunAt).toBe("2026-06-29T09:00:00.000Z");
  expect(completed?.claimedByWorkerId).toBeNull();
  expect(completed?.fencingToken).toBeNull();
  expect(client.queries.some((query) => query.sql.includes("next_run_at = report_schedule.next_run_at + (report_schedule.interval_seconds::bigint * interval '1 second')"))).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("AND fencing_token = $4"))).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("AND EXISTS"))).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("AND started_at = $10::timestamptz"))).toBe(true);
});

test("Postgres report runtime reclaims expired report schedule claims without skipping the window", async () => {
  const client = new FakeReportClient();
  client.schedule = {
    workspaceId: "ws_runtime",
    id: "rps_daily",
    name: "daily",
    enabled: true,
    intervalSeconds: 3600,
    nextRunAt: "2026-06-29T08:00:00.000Z",
    lastRunAt: null,
    subject: "Daily uptime",
    channels: { email: false, sms: false, logs: true },
    claimedByWorkerId: null,
    fencingToken: null,
    leaseExpiresAt: null,
    version: 1,
  };
  const runtime = createPostgresReportRuntime({
    client,
    workspaceId: "ws_runtime",
    now: () => new Date(client.now),
  });

  client.now = "2026-06-29T08:05:00.000Z";
  const firstClaim = await runtime.claimReportSchedule({
    id: "rps_daily",
    workerId: "reporter-1",
    leaseTtlMs: 60_000,
  });

  client.now = "2026-06-29T08:06:01.000Z";
  const reclaimed = await runtime.claimReportSchedule({
    id: "rps_daily",
    workerId: "reporter-2",
    leaseTtlMs: 60_000,
  });
  const staleComplete = await runtime.completeReportScheduleClaim({
    id: "rps_daily",
    workerId: "reporter-1",
    fencingToken: firstClaim!.fencingToken!,
  });
  const reportRun = await runtime.beginReportRunForScheduleClaim({
    scheduleId: "rps_daily",
    workerId: "reporter-2",
    scheduleFencingToken: reclaimed!.fencingToken!,
    leaseTtlMs: 60_000,
  });
  const finished = await runtime.finishReportRunForScheduleClaim({
    scheduleId: "rps_daily",
    workerId: "reporter-2",
    scheduleFencingToken: reclaimed!.fencingToken!,
    reportRunFencingToken: reportRun!.fencingToken!,
    status: "succeeded",
  });
  const completed = finished?.schedule;

  expect(firstClaim?.lastRunAt).toBeNull();
  expect(firstClaim?.nextRunAt).toBe("2026-06-29T08:00:00.000Z");
  expect(reclaimed?.lastRunAt).toBeNull();
  expect(reclaimed?.nextRunAt).toBe("2026-06-29T08:00:00.000Z");
  expect(reclaimed?.claimedByWorkerId).toBe("reporter-2");
  expect(staleComplete).toBeNull();
  expect(reportRun?.startedAt).toBe("2026-06-29T08:00:00.000Z");
  expect(finished?.reportRun.status).toBe("succeeded");
  expect(completed?.lastRunAt).toBe("2026-06-29T08:00:00.000Z");
  expect(completed?.nextRunAt).toBe("2026-06-29T09:00:00.000Z");
  expect(client.queries.some((query) => query.sql.includes("AND next_run_at <= now()"))).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("AND lease_expires_at > now()"))).toBe(true);
});

test("Postgres report runtime omits raw channel payloads from report schedule discovery and claims", async () => {
  const client = new FakeReportClient();
  client.schedule = {
    workspaceId: "ws_runtime",
    id: "rps_sensitive",
    name: "sensitive",
    enabled: true,
    intervalSeconds: 3600,
    nextRunAt: "2026-06-29T08:00:00.000Z",
    lastRunAt: null,
    subject: "Sensitive uptime",
    channels: { email: true, sms: true, logs: true },
    claimedByWorkerId: null,
    fencingToken: null,
    leaseExpiresAt: null,
    version: 1,
  };
  client.rawScheduleChannels = {
    email: { apiUrl: "https://mailery.example.invalid/send", to: "ops@example.invalid", from: "status@example.invalid" },
    sms: { to: "+15550101010" },
    logs: { apiUrl: "https://logs.example.invalid/ingest?token=raw-secret", projectId: "open-uptime" },
  };
  const runtime = createPostgresReportRuntime({ client, workspaceId: "ws_runtime" });

  const due = await runtime.listDueReportSchedules({ now: "2026-06-29T08:05:00.000Z" });
  const claimed = await runtime.claimReportSchedule({
    id: "rps_sensitive",
    workerId: "reporter-1",
    leaseTtlMs: 60_000,
  });

  const serialized = JSON.stringify({ due, claimed });
  expect(due[0]!.channels).toEqual({ email: true, sms: true, logs: true });
  expect(claimed?.channels).toEqual({ email: true, sms: true, logs: true });
  expect(serialized).not.toContain("ops@example.invalid");
  expect(serialized).not.toContain("+15550101010");
  expect(serialized).not.toContain("mailery.example.invalid");
  expect(serialized).not.toContain("logs.example.invalid");
  expect(serialized).not.toContain("raw-secret");
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

  await expect(runtime.createDeliveryAttempt({
    reportRunId: "rpr_runtime",
    channel: "email",
    channelRefId: "ops-email",
    provider: "logs",
  })).rejects.toThrow("provider must be mailery for email");

  await expect(runtime.createDeliveryAttempt({
    reportRunId: "rpr_runtime",
    channel: "sms",
    channelRefId: "ops-sms",
    provider: "mailery",
  })).rejects.toThrow("provider must be telephony for sms");

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
  const checks = Object.fromEntries(readiness.checks.map((check) => [check.name, check.ok]));

  expect(readiness.status).toBe("blocked");
  expect(readiness.canWriteReportMetadata).toBe(true);
  expect(checks).toMatchObject({
    "report-runtime-schema-verified": true,
    "report-run-metadata-writer": true,
    "report-schedule-claiming": true,
    "report-run-state-machine": true,
    "report-artifact-object-store": false,
    "report-audit-export": false,
    "report-delivery-alarms": false,
    "reporter-worker-liveness": false,
  });
  expect(readiness.capabilities).toMatchObject({
    reportRunWriter: true,
    scheduleClaiming: true,
    reportRunStateMachine: true,
    artifactObjectWriter: false,
    auditExport: false,
    deliveryAlarms: false,
  });
  expect(readiness.blockers.join("\n")).not.toContain("report-schedule-claiming");
  expect(readiness.blockers.join("\n")).not.toContain("report-run-state-machine");
  expect(readiness.blockers.join("\n")).toContain("reporter-worker-liveness");
});

test("Postgres report runtime honors custom workspace setting and rejects unsafe hosted construction", async () => {
  const client = new FakeReportClient();
  const runtime = createPostgresReportRuntime({
    client,
    workspaceId: "ws_runtime",
    workspaceSetting: "hasna.workspace_id",
  });

  await runtime.recordReportRun({
    id: "rpr_runtime",
    status: "success",
    deliveries: [],
  });

  expect(client.queries.some((query) => query.sql.includes("set_config($1, $2, true)") && query.params?.[0] === "hasna.workspace_id")).toBe(true);
  expect(() => createPostgresReportRuntime({
    databaseUrl: "postgres://svc:secret@db.example.invalid/uptime",
    workspaceId: "ws_runtime",
  })).toThrow("sslmode=require");

  const previousMode = process.env.HASNA_UPTIME_MODE;
  const previousWorkspace = process.env.HASNA_UPTIME_WORKSPACE_ID;
  try {
    process.env.HASNA_UPTIME_MODE = "hosted";
    delete process.env.HASNA_UPTIME_WORKSPACE_ID;
    expect(() => createPostgresReportRuntime({ client: new FakeReportClient() })).toThrow("workspace");
  } finally {
    if (previousMode == null) delete process.env.HASNA_UPTIME_MODE;
    else process.env.HASNA_UPTIME_MODE = previousMode;
    if (previousWorkspace == null) delete process.env.HASNA_UPTIME_WORKSPACE_ID;
    else process.env.HASNA_UPTIME_WORKSPACE_ID = previousWorkspace;
  }
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
    claimed_by_worker_id: row.claimedByWorkerId,
    fencing_token: row.fencingToken,
    lease_expires_at: row.leaseExpiresAt,
    version: row.version,
  };
}

function addMillis(timestamp: string, millis: number): string {
  return new Date(new Date(timestamp).getTime() + millis).toISOString();
}

function isTerminalReportRunStatus(status: PostgresReportRunRecord["status"]): boolean {
  return status === "succeeded" || status === "failed" || status === "retry_exhausted";
}

function snakeSchedule(row: PostgresReportScheduleClaimRecord): Record<string, unknown> {
  return {
    workspace_id: row.workspaceId,
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    interval_seconds: row.intervalSeconds,
    next_run_at: row.nextRunAt,
    last_run_at: row.lastRunAt,
    subject: row.subject,
    channels_json: JSON.stringify(row.channels),
    claimed_by_worker_id: row.claimedByWorkerId,
    fencing_token: row.fencingToken,
    lease_expires_at: row.leaseExpiresAt,
    version: row.version,
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
