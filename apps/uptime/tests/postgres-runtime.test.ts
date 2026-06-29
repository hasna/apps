import { expect, test } from "bun:test";
import {
  buildPostgresRuntimeReadiness,
  checkJobIdempotencyKey,
  createPostgresRuntime,
  sanitizePostgresRuntimeError,
  type PostgresAuditEventRecord,
  type PostgresCheckJobRecord,
  type PostgresCheckResultRecord,
  type PostgresMonitorRecord,
  type PostgresProbeIdentityRecord,
  type PostgresProbeSubmissionRecord,
  type PostgresSyncTombstoneRecord,
} from "../src/postgres-runtime.js";
import type { PostgresQueryClient } from "../src/postgres.js";
import { probeResultPayloadHash } from "../src/probes.js";

class FakeRuntimeClient implements PostgresQueryClient {
  readonly queries: Array<{ sql: string; params?: unknown[] }> = [];
  monitor: PostgresMonitorRecord | null = null;
  probe: PostgresProbeIdentityRecord | null = null;
  job: PostgresCheckJobRecord | null = null;
  result: PostgresCheckResultRecord | null = null;
  submission: PostgresProbeSubmissionRecord | null = null;
  audit: PostgresAuditEventRecord | null = null;
  tombstone: PostgresSyncTombstoneRecord | null = null;
  releaseCount = 0;

  async query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }> {
    this.queries.push({ sql, params });
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK" || sql.includes("set_config(")) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("INSERT INTO \"uptime\".\"monitors\"")) {
      this.monitor = {
        workspaceId: String(params?.[0]),
        id: String(params?.[1]),
        name: String(params?.[2]),
        kind: params?.[3] as PostgresMonitorRecord["kind"],
        url: params?.[4] == null ? null : String(params[4]),
        host: params?.[5] == null ? null : String(params[5]),
        port: params?.[6] == null ? null : Number(params[6]),
        method: String(params?.[7]),
        expectedStatus: params?.[8] == null ? null : Number(params[8]),
        intervalSeconds: Number(params?.[9]),
        timeoutMs: Number(params?.[10]),
        retryCount: Number(params?.[11]),
        enabled: Boolean(params?.[12]),
        status: params?.[13] as PostgresMonitorRecord["status"],
        lastCheckedAt: params?.[14] == null ? null : String(params[14]),
        revision: 1,
        actor: params?.[15] == null ? null : String(params[15]),
        origin: params?.[16] == null ? null : String(params[16]),
        idempotencyKey: params?.[17] == null ? null : String(params[17]),
        createdAt: "2026-06-29T10:00:00.000Z",
        updatedAt: "2026-06-29T10:00:00.000Z",
        deletedAt: null,
      };
      return { rows: [snakeMonitor(this.monitor)], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO \"uptime\".\"probe_identities\"")) {
      this.probe = {
        workspaceId: String(params?.[0]),
        id: String(params?.[1]),
        name: String(params?.[2]),
        probeClass: params?.[3] as PostgresProbeIdentityRecord["probeClass"],
        probeLocation: String(params?.[4]),
        machineId: params?.[5] == null ? null : String(params[5]),
        publicKeyPem: String(params?.[6]),
        publicKeyFingerprint: String(params?.[7]),
        enabled: Boolean(params?.[8]),
        capabilities: JSON.parse(String(params?.[9])),
        lastSeenAt: params?.[10] == null ? null : String(params[10]),
        version: 1,
      };
      return { rows: [snakeProbe(this.probe)], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO \"uptime\".\"check_jobs\"")) {
      if (!this.job) {
        const monitorSnapshot = JSON.parse(String(params?.[4]));
        this.job = {
          workspaceId: String(params?.[0]),
          id: String(params?.[1]),
          monitorId: String(params?.[2]),
          monitorRevision: Number(params?.[3]),
          monitorSnapshot,
          scheduleSlot: String(params?.[5]),
          probePolicy: JSON.parse(String(params?.[6])),
          probePolicyHash: String(params?.[7]),
          status: "pending",
          claimedByProbeId: null,
          fencingToken: null,
          dueAt: String(params?.[8]),
          claimedAt: null,
          leaseExpiresAt: null,
          submittedResultId: null,
          deployGeneration: Number(params?.[9]),
          version: 1,
          createdAt: "2026-06-29T10:00:00.000Z",
          updatedAt: "2026-06-29T10:00:00.000Z",
        };
      }
      return { rows: [snakeJob(this.job)], rowCount: 1 };
    }
    if (sql.includes("SELECT * FROM \"uptime\".\"check_jobs\"") && sql.includes("ORDER BY due_at")) {
      return { rows: this.job ? [snakeJob(this.job)] : [], rowCount: this.job ? 1 : 0 };
    }
    if (sql.includes("WITH probe AS") && sql.includes("UPDATE \"uptime\".\"check_jobs\" AS job")) {
      if (!this.job || !this.probe) return { rows: [], rowCount: 0 };
      if (this.job.status === "claimed" && this.job.claimedByProbeId === String(params?.[2]) && this.job.fencingToken) {
        return { rows: [snakeJob(this.job)], rowCount: 1 };
      }
      this.job = {
        ...this.job,
        status: "claimed",
        claimedByProbeId: String(params?.[2]),
        fencingToken: String(params?.[3]),
        claimedAt: "2026-06-29T10:01:00.000Z",
        leaseExpiresAt: "2026-06-29T10:03:00.000Z",
        version: this.job.version + 1,
      };
      return { rows: [snakeJob(this.job)], rowCount: 1 };
    }
    if (sql.includes("SELECT * FROM \"uptime\".\"probe_submissions\"")) {
      return { rows: this.submission ? [snakeSubmission(this.submission)] : [], rowCount: this.submission ? 1 : 0 };
    }
    if (sql.includes("SELECT * FROM \"uptime\".\"check_jobs\"") && sql.includes("FOR UPDATE")) {
      return { rows: this.job ? [snakeJob(this.job)] : [], rowCount: this.job ? 1 : 0 };
    }
    if (sql.includes("SELECT * FROM \"uptime\".\"monitors\"") && sql.includes("NOT EXISTS")) {
      const requestedProbePolicyHash = params?.[5] == null ? null : String(params[5]);
      const hasOpenCurrentJob = this.job
        && this.monitor
        && this.job.workspaceId === this.monitor.workspaceId
        && this.job.monitorId === this.monitor.id
        && this.job.monitorRevision === this.monitor.revision
        && this.job.submittedResultId === null
        && (this.job.status === "pending" || this.job.status === "claimed" || this.job.status === "expired")
        && (!requestedProbePolicyHash || this.job.probePolicyHash === requestedProbePolicyHash);
      return { rows: hasOpenCurrentJob || !this.monitor ? [] : [snakeMonitor(this.monitor)], rowCount: hasOpenCurrentJob || !this.monitor ? 0 : 1 };
    }
    if (sql.includes("SELECT * FROM \"uptime\".\"monitors\"")) {
      return { rows: this.monitor ? [snakeMonitor(this.monitor)] : [], rowCount: this.monitor ? 1 : 0 };
    }
    if (sql.includes("SELECT id, probe_class, probe_location") && sql.includes("FROM \"uptime\".\"probe_identities\"")) {
      return {
        rows: this.probe ? [{
          id: this.probe.id,
          probe_class: this.probe.probeClass,
          probe_location: this.probe.probeLocation,
        }] : [],
        rowCount: this.probe ? 1 : 0,
      };
    }
    if (sql.includes("UPDATE \"uptime\".\"monitors\"") && sql.includes("last_checked_at = $4")) {
      if (!this.monitor || this.monitor.id !== String(params?.[1]) || this.monitor.revision !== Number(params?.[4])) {
        return { rows: [], rowCount: 0 };
      }
      this.monitor = {
        ...this.monitor,
        status: params?.[2] as PostgresMonitorRecord["status"],
        lastCheckedAt: String(params?.[3]),
        updatedAt: "2026-06-29T10:01:10.000Z",
      };
      return { rows: [snakeMonitor(this.monitor)], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO \"uptime\".\"check_results\"")) {
      this.result = {
        workspaceId: String(params?.[0]),
        id: String(params?.[1]),
        monitorId: String(params?.[2]),
        jobId: params?.[3] == null ? null : String(params[3]),
        probeId: params?.[4] == null ? null : String(params[4]),
        monitorRevision: Number(params?.[5]),
        scheduleSlot: String(params?.[6]),
        probeClass: params?.[7] as PostgresCheckResultRecord["probeClass"],
        probeLocation: String(params?.[8]),
        probePolicyHash: String(params?.[9]),
        checkedAt: String(params?.[10]),
        status: params?.[11] as PostgresCheckResultRecord["status"],
        latencyMs: params?.[12] == null ? null : Number(params[12]),
        statusCode: params?.[13] == null ? null : Number(params[13]),
        error: params?.[14] == null ? null : String(params[14]),
        attemptCount: Number(params?.[15]),
        evidence: params?.[16] == null ? null : JSON.parse(String(params[16])),
        actor: params?.[17] == null ? null : String(params[17]),
        origin: params?.[18] == null ? null : String(params[18]),
        idempotencyKey: params?.[19] == null ? null : String(params[19]),
      };
      return { rows: [snakeResult(this.result)], rowCount: 1 };
    }
    if (sql.includes("SELECT * FROM \"uptime\".\"check_results\"")) {
      return { rows: this.result ? [snakeResult(this.result)] : [], rowCount: this.result ? 1 : 0 };
    }
    if (sql.includes("INSERT INTO \"uptime\".\"probe_submissions\"")) {
      this.submission = {
        workspaceId: String(params?.[0]),
        id: String(params?.[1]),
        probeId: String(params?.[2]),
        jobId: String(params?.[3]),
        monitorId: String(params?.[4]),
        checkResultId: String(params?.[5]),
        nonce: String(params?.[6]),
        payloadHash: String(params?.[7]),
        checkedAt: String(params?.[8]),
        submittedAt: "2026-06-29T10:02:00.000Z",
        monitorRevision: Number(params?.[12]),
        scheduleSlot: String(params?.[13]),
        probeClass: params?.[14] as PostgresProbeSubmissionRecord["probeClass"],
        probeLocation: String(params?.[15]),
        probePolicyHash: String(params?.[16]),
      };
      return { rows: [snakeSubmission(this.submission)], rowCount: 1 };
    }
    if (sql.includes("UPDATE \"uptime\".\"check_jobs\"") && sql.includes("submitted_result_id = $4")) {
      if (!this.job || this.job.status !== "claimed" || this.job.fencingToken !== params?.[4]) {
        return { rows: [], rowCount: 0 };
      }
      this.job = {
        ...this.job,
        status: "submitted",
        submittedResultId: String(params?.[3]),
        fencingToken: null,
        leaseExpiresAt: null,
        version: this.job.version + 1,
      };
      return { rows: [snakeJob(this.job)], rowCount: 1 };
    }
    if (sql.includes("UPDATE \"uptime\".\"check_jobs\"") && sql.includes("status = 'cancelled'")) {
      if (!this.job || this.job.status !== "claimed" || this.job.fencingToken !== params?.[3]) {
        return { rows: [], rowCount: 0 };
      }
      this.job = {
        ...this.job,
        status: "cancelled",
        fencingToken: null,
        leaseExpiresAt: null,
        version: this.job.version + 1,
      };
      return { rows: [snakeJob(this.job)], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO \"uptime\".\"audit_events\"")) {
      this.audit = {
        workspaceId: String(params?.[0]),
        id: String(params?.[1]),
        action: String(params?.[2]),
        resourceType: params?.[3] == null ? null : String(params[3]),
        resourceId: params?.[4] == null ? null : String(params[4]),
        message: params?.[5] == null ? null : String(params[5]),
        metadata: JSON.parse(String(params?.[6])),
        actor: params?.[7] == null ? null : String(params[7]),
        origin: params?.[8] == null ? null : String(params[8]),
        idempotencyKey: params?.[9] == null ? null : String(params[9]),
        createdAt: String(params?.[10]),
      };
      return { rows: [snakeAudit(this.audit)], rowCount: 1 };
    }
    if (sql.includes("UPDATE \"uptime\".\"monitors\"") && sql.includes("deleted_at = $3")) {
      if (this.monitor) this.monitor = { ...this.monitor, deletedAt: String(params?.[2]), enabled: false };
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO \"uptime\".\"sync_tombstones\"")) {
      this.tombstone = {
        workspaceId: String(params?.[0]),
        resourceType: String(params?.[1]),
        resourceId: String(params?.[2]),
        deletedAt: String(params?.[3]),
        version: Number(params?.[4]),
        actor: params?.[5] == null ? null : String(params[5]),
        origin: params?.[6] == null ? null : String(params[6]),
        idempotencyKey: params?.[7] == null ? null : String(params[7]),
        metadata: JSON.parse(String(params?.[8])),
      };
      return { rows: [snakeTombstone(this.tombstone)], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  async connect(): Promise<FakeRuntimeClient> {
    return this;
  }

  release(): void {
    this.releaseCount += 1;
  }
}

test("Postgres runtime records monitors, probe leases, submissions, audit, and tombstones in workspace transactions", async () => {
  const client = new FakeRuntimeClient();
  const runtime = createPostgresRuntime({
    client,
    workspaceId: "ws_runtime",
    now: () => new Date("2026-06-29T10:00:00.000Z"),
  });

  const monitor = await runtime.upsertMonitor({
    id: "mon_homepage",
    name: "Homepage",
    kind: "http",
    url: "https://example.com/health",
    expectedStatus: 200,
    actor: "operator",
    idempotencyKey: "idem-monitor",
  });
  const probe = await runtime.upsertProbeIdentity({
    id: "prb_public",
    name: "Public eu-west-1",
    probeClass: "public",
    probeLocation: "eu-west-1",
    publicKeyPem: "-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----",
    publicKeyFingerprint: "a".repeat(64),
    capabilities: { http: true },
  });
  const scheduleSlot = "2026-06-29T10:00:00.000Z";
  const job = await runtime.createCheckJob({
    monitorId: monitor.id,
    monitorRevision: monitor.revision,
    scheduleSlot,
    probePolicy: { probeClass: "public", locations: ["us-east-1", "eu-west-1"] },
    actor: "scheduler",
  });
  const due = await runtime.listDueCheckJobs({ now: "2026-06-29T10:01:00.000Z" });
  const schedulerMonitors = await runtime.listSchedulerMonitors({
    now: "2026-06-29T10:01:00.000Z",
    limit: 10,
    probePolicy: { probeClass: "public", locations: ["us-east-1", "eu-west-1"] },
  });
  const schedulerMonitorsOtherPolicy = await runtime.listSchedulerMonitors({
    now: "2026-06-29T10:01:00.000Z",
    limit: 10,
    probePolicy: { probeClass: "private", locations: ["operator-02"] },
  });
  const fetchedMonitor = await runtime.getMonitor({ id: monitor.id });
  const claimed = await runtime.claimCheckJob({
    jobId: job.id,
    probeId: probe.id,
    leaseTtlMs: 120_000,
  });
  const retriedClaim = await runtime.claimCheckJob({
    jobId: job.id,
    probeId: probe.id,
    leaseTtlMs: 120_000,
  });
  const submittedEvidence = {
    kind: "http_target_policy" as const,
    mode: "hosted" as const,
    finalUrl: "https://example.com/health",
    redirectCount: 0,
    decisions: [],
    redacted: true,
    redactionStatus: "redacted" as const,
    retentionClass: "short" as const,
  };
  const submittedPayloadHash = probeResultPayloadHash({
    probeId: probe.id,
    jobId: job.id,
    scheduleSlot,
    fencingToken: claimed!.fencingToken!,
    monitorId: monitor.id,
    nonce: "nonce-1",
    checkedAt: "2026-06-29T10:01:10.000Z",
    status: "up",
    latencyMs: 42,
    statusCode: 200,
    error: null,
    attemptCount: 1,
    monitorRevision: monitor.revision,
    evidence: submittedEvidence,
  });
  const submitted = await runtime.submitProbeCheckResult({
    jobId: job.id,
    probeId: probe.id,
    fencingToken: claimed!.fencingToken!,
    nonce: "nonce-1",
    checkedAt: "2026-06-29T10:01:10.000Z",
    status: "up",
    latencyMs: 42,
    statusCode: 200,
    payloadHash: submittedPayloadHash,
    evidence: submittedEvidence,
  });
  const replayedSubmission = await runtime.submitProbeCheckResult({
    jobId: job.id,
    probeId: probe.id,
    fencingToken: claimed!.fencingToken!,
    nonce: "nonce-1",
    checkedAt: "2026-06-29T10:01:10.000Z",
    status: "up",
    latencyMs: 42,
    statusCode: 200,
    payloadHash: submittedPayloadHash,
    evidence: submittedEvidence,
  });
  const audit = await runtime.recordAuditEvent({
    action: "check.submitted",
    resourceType: "check_job",
    resourceId: job.id,
    metadata: { result: "up" },
    actor: "public-probe",
  });
  const tombstone = await runtime.tombstoneResource({
    resourceType: "monitor",
    resourceId: monitor.id,
    version: 2,
    actor: "operator",
    metadata: { reason: "test-cleanup" },
  });

  const expectedJobKey = checkJobIdempotencyKey({
    workspaceId: "ws_runtime",
    monitorId: monitor.id,
    monitorRevision: monitor.revision,
    scheduleSlot,
    probePolicyHash: job.probePolicyHash,
  });
  expect(expectedJobKey).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(job.id).toBe(`job_${expectedJobKey.replace("sha256:", "").slice(0, 32)}`);
  expect(fetchedMonitor?.id).toBe(monitor.id);
  expect(schedulerMonitors).toHaveLength(0);
  expect(schedulerMonitorsOtherPolicy).toHaveLength(1);
  expect(due[0]!.fencingToken).toBeNull();
  expect(claimed?.status).toBe("claimed");
  expect(claimed?.claimedByProbeId).toBe(probe.id);
  expect(retriedClaim?.fencingToken).toBe(claimed?.fencingToken);
  expect(submitted.job.status).toBe("submitted");
  expect(submitted.job.fencingToken).toBeNull();
  expect(submitted.result.status).toBe("up");
  expect(client.monitor?.status).toBe("up");
  expect(client.monitor?.lastCheckedAt).toBe("2026-06-29T10:01:10.000Z");
  expect(submitted.result.probeLocation).toBe("eu-west-1");
  expect(submitted.submission.probeLocation).toBe("eu-west-1");
  expect(submitted.submission.payloadHash).toBe(submittedPayloadHash);
  expect(replayedSubmission.submission.checkResultId).toBe(submitted.submission.checkResultId);
  expect(replayedSubmission.job.status).toBe("submitted");
  expect(audit.metadata).toEqual({ result: "up" });
  expect(tombstone.resourceType).toBe("monitor");
  expect(client.queries.map((query) => query.sql).filter((sql) => sql === "BEGIN").length).toBeGreaterThanOrEqual(8);
  expect(client.queries.some((query) => query.sql.includes("set_config($1, $2, true)") && query.params?.[0] === "app.workspace_id")).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("now() + ($5::bigint * interval '1 millisecond')"))).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("monitor_snapshot <> '{}'::jsonb"))).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("NOT EXISTS") && query.sql.includes("open_job.status IN ('pending', 'claimed', 'expired')"))).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("AND ($6::text IS NULL OR open_job.probe_policy_hash = $6)") && typeof query.params?.[5] === "string")).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("kind IN ('http', 'tcp')"))).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("(COALESCE(last_checked_at, created_at), id) >"))).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("last_checked_at + (interval_seconds::bigint * interval '1 second')"))).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("monitor_snapshot = '{}'::jsonb") && query.sql.includes("deleted_at IS NOT NULL"))).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("AND fencing_token = $5"))).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("payload_hash IS NOT DISTINCT FROM EXCLUDED.payload_hash"))).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("UPDATE \"uptime\".\"monitors\"") && query.sql.includes("version = $5"))).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("sync_tombstones"))).toBe(true);
  expect(client.releaseCount).toBeGreaterThan(0);
});

test("Postgres runtime soft-deletes every advertised tombstone resource type", async () => {
  const client = new FakeRuntimeClient();
  const runtime = createPostgresRuntime({
    client,
    workspaceId: "ws_runtime",
    now: () => new Date("2026-06-29T10:00:00.000Z"),
  });

  for (const resourceType of ["monitor", "check_job", "probe_identity", "report_schedule", "incident"] as const) {
    await runtime.tombstoneResource({
      resourceType,
      resourceId: `res_${resourceType}`,
      actor: "operator",
    });
  }

  const sql = client.queries.map((query) => query.sql).join("\n");
  expect(sql).toContain("UPDATE \"uptime\".\"monitors\"");
  expect(sql).toContain("UPDATE \"uptime\".\"check_jobs\"");
  expect(sql).toContain("UPDATE \"uptime\".\"probe_identities\"");
  expect(sql).toContain("UPDATE \"uptime\".\"report_schedules\"");
  expect(sql).toContain("UPDATE \"uptime\".\"incidents\"");
});

test("Postgres runtime rejects probe payload hash mismatches", async () => {
  const client = new FakeRuntimeClient();
  const runtime = createPostgresRuntime({ client, workspaceId: "ws_runtime" });
  await runtime.upsertMonitor({ id: "mon_homepage", name: "Homepage", kind: "http", url: "https://example.com" });
  await runtime.upsertProbeIdentity({
    id: "prb_public",
    name: "Public us-east-1",
    probeClass: "public",
    probeLocation: "us-east-1",
    publicKeyPem: "-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----",
    publicKeyFingerprint: "a".repeat(64),
  });
  const job = await runtime.createCheckJob({
    monitorId: "mon_homepage",
    monitorRevision: 1,
    scheduleSlot: "2026-06-29T10:00:00.000Z",
    probePolicy: { probeClass: "public", locations: ["us-east-1"] },
  });
  const claimed = await runtime.claimCheckJob({ jobId: job.id, probeId: "prb_public" });

  await expect(runtime.submitProbeCheckResult({
    jobId: job.id,
    probeId: "prb_public",
    fencingToken: claimed!.fencingToken!,
    nonce: "nonce-1",
    checkedAt: "2026-06-29T10:01:10.000Z",
    status: "up",
    payloadHash: "d".repeat(64),
  })).rejects.toThrow("payload hash mismatch");
});

test("Postgres runtime rejects probe nonce replay with a different payload hash", async () => {
  const client = new FakeRuntimeClient();
  const runtime = createPostgresRuntime({ client, workspaceId: "ws_runtime" });
  await runtime.upsertMonitor({ id: "mon_homepage", name: "Homepage", kind: "http", url: "https://example.com" });
  await runtime.upsertProbeIdentity({
    id: "prb_public",
    name: "Public us-east-1",
    probeClass: "public",
    probeLocation: "us-east-1",
    publicKeyPem: "-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----",
    publicKeyFingerprint: "a".repeat(64),
  });
  const job = await runtime.createCheckJob({
    monitorId: "mon_homepage",
    monitorRevision: 1,
    scheduleSlot: "2026-06-29T10:00:00.000Z",
    probePolicy: { probeClass: "public", locations: ["us-east-1"] },
  });
  const claimed = await runtime.claimCheckJob({ jobId: job.id, probeId: "prb_public" });
  const payloadHash = probeResultPayloadHash({
    probeId: "prb_public",
    jobId: job.id,
    scheduleSlot: job.scheduleSlot,
    fencingToken: claimed!.fencingToken!,
    monitorId: "mon_homepage",
    nonce: "nonce-1",
    checkedAt: "2026-06-29T10:01:10.000Z",
    status: "up",
    latencyMs: null,
    statusCode: null,
    error: null,
    attemptCount: 1,
    monitorRevision: 1,
    evidence: null,
  });
  client.submission = {
    workspaceId: "ws_runtime",
    id: "psb_existing",
    probeId: "prb_public",
    jobId: job.id,
    monitorId: "mon_homepage",
    monitorRevision: 1,
    scheduleSlot: "2026-06-29T10:00:00.000Z",
    probeClass: "public",
    probeLocation: "us-east-1",
    probePolicyHash: job.probePolicyHash,
    payloadHash: "c".repeat(64),
    checkResultId: "chk_existing",
    nonce: "nonce-1",
    checkedAt: "2026-06-29T10:01:10.000Z",
    submittedAt: "2026-06-29T10:01:11.000Z",
  };

  await expect(runtime.submitProbeCheckResult({
    jobId: job.id,
    probeId: "prb_public",
    fencingToken: claimed!.fencingToken!,
    nonce: "nonce-1",
    checkedAt: "2026-06-29T10:01:10.000Z",
    status: "up",
    payloadHash,
  })).rejects.toThrow("nonce replay conflict");
});

test("Postgres runtime readiness is honest and does not promote hosted workers", () => {
  const readiness = buildPostgresRuntimeReadiness({
    databaseUrl: "postgres://svc:raw-password@db.example.invalid/uptime?sslmode=require",
    workspaceId: "ws_runtime",
    schemaVerified: true,
  });
  const checks = Object.fromEntries(readiness.checks.map((check) => [check.name, check.ok]));
  const serialized = JSON.stringify(readiness);

  expect(readiness.status).toBe("blocked");
  expect(readiness.canUseCoreRuntime).toBe(true);
  expect(readiness.canPromoteHostedWorkers).toBe(false);
  expect(checks["postgres-monitor-store"]).toBe(true);
  expect(checks["postgres-check-jobs-leases"]).toBe(true);
  expect(checks["uptime-service-integration"]).toBe(false);
  expect(checks["cloud-worker-promotable"]).toBe(false);
  expect(readiness.database.redactedUrl).toBe("postgres://user:redacted@db.example.invalid/uptime");
  expect(serialized).not.toContain("raw-password");
  expect(serialized).not.toContain("sslmode=require");
});

test("Postgres runtime honors custom workspace setting and rejects unsafe hosted construction", async () => {
  const client = new FakeRuntimeClient();
  const runtime = createPostgresRuntime({
    client,
    workspaceId: "ws_runtime",
    workspaceSetting: "hasna.workspace_id",
  });

  await runtime.recordAuditEvent({ action: "runtime.ready" });

  expect(client.queries.some((query) => query.sql.includes("set_config($1, $2, true)") && query.params?.[0] === "hasna.workspace_id")).toBe(true);
  expect(() => createPostgresRuntime({
    databaseUrl: "postgres://svc:secret@db.example.invalid/uptime",
    workspaceId: "ws_runtime",
  })).toThrow("sslmode=require");

  const previousMode = process.env.HASNA_UPTIME_MODE;
  const previousWorkspace = process.env.HASNA_UPTIME_WORKSPACE_ID;
  try {
    process.env.HASNA_UPTIME_MODE = "hosted";
    delete process.env.HASNA_UPTIME_WORKSPACE_ID;
    expect(() => createPostgresRuntime({ client: new FakeRuntimeClient() })).toThrow("workspace");
  } finally {
    if (previousMode == null) delete process.env.HASNA_UPTIME_MODE;
    else process.env.HASNA_UPTIME_MODE = previousMode;
    if (previousWorkspace == null) delete process.env.HASNA_UPTIME_WORKSPACE_ID;
    else process.env.HASNA_UPTIME_WORKSPACE_ID = previousWorkspace;
  }
});

test("Postgres runtime rejects unredacted evidence, secret metadata, and unsafe monitor URLs", async () => {
  const runtime = createPostgresRuntime({ client: new FakeRuntimeClient(), workspaceId: "ws_runtime" });

  await expect(runtime.upsertMonitor({
    name: "Unsafe",
    kind: "http",
    url: "https://user:password@example.com",
  })).rejects.toThrow("credentials");

  await expect(runtime.recordAuditEvent({
    action: "unsafe",
    metadata: { token: "raw" },
  })).rejects.toThrow("secret material");

  await expect(runtime.submitProbeCheckResult({
    jobId: "job_missing",
    probeId: "prb_missing",
    fencingToken: "fence_missing",
    nonce: "nonce-1",
    checkedAt: "2026-06-29T10:01:10.000Z",
    status: "up",
    payloadHash: "b".repeat(64),
    evidence: {
      kind: "browser_page",
      finalUrl: null,
      navigationStatus: null,
      consoleErrors: [],
      pageErrors: [],
      failedRequests: [],
      screenshot: null,
      artifacts: [],
      redacted: false,
      redactionStatus: "redacted",
      retentionClass: "short",
    },
  })).rejects.toThrow("evidence must be redacted");
});

test("Postgres runtime sanitizes database URLs and bearer material in errors", () => {
  const message = sanitizePostgresRuntimeError(
    new Error("failed postgres://svc:raw-password@db.invalid/app?sslmode=require token=raw-token Bearer raw-bearer"),
    "postgres://svc:raw-password@db.invalid/app?sslmode=require",
  );

  expect(message).toContain("postgres://user:redacted@db.invalid/app");
  expect(message).toContain("token=redacted");
  expect(message).toContain("Bearer redacted");
  expect(message).not.toContain("raw-password");
  expect(message).not.toContain("raw-token");
  expect(message).not.toContain("raw-bearer");
  expect(message).not.toContain("sslmode=require");
});

function snakeMonitor(row: PostgresMonitorRecord): Record<string, unknown> {
  return {
    workspace_id: row.workspaceId,
    id: row.id,
    name: row.name,
    kind: row.kind,
    url: row.url,
    host: row.host,
    port: row.port,
    method: row.method,
    expected_status: row.expectedStatus,
    interval_seconds: row.intervalSeconds,
    timeout_ms: row.timeoutMs,
    retry_count: row.retryCount,
    enabled: row.enabled,
    status: row.status,
    last_checked_at: row.lastCheckedAt,
    version: row.revision,
    actor: row.actor,
    origin: row.origin,
    idempotency_key: row.idempotencyKey,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    deleted_at: row.deletedAt,
  };
}

function snakeProbe(row: PostgresProbeIdentityRecord): Record<string, unknown> {
  return {
    workspace_id: row.workspaceId,
    id: row.id,
    name: row.name,
    probe_class: row.probeClass,
    probe_location: row.probeLocation,
    machine_id: row.machineId,
    public_key_pem: row.publicKeyPem,
    public_key_fingerprint: row.publicKeyFingerprint,
    enabled: row.enabled,
    capabilities: JSON.stringify(row.capabilities),
    last_seen_at: row.lastSeenAt,
    version: row.version,
  };
}

function snakeJob(row: PostgresCheckJobRecord): Record<string, unknown> {
  return {
    workspace_id: row.workspaceId,
    id: row.id,
    monitor_id: row.monitorId,
    monitor_version: row.monitorRevision,
    monitor_snapshot: JSON.stringify(row.monitorSnapshot),
    schedule_slot: row.scheduleSlot,
    probe_policy: JSON.stringify(row.probePolicy),
    probe_policy_hash: row.probePolicyHash,
    status: row.status,
    claimed_by_probe_id: row.claimedByProbeId,
    fencing_token: row.fencingToken,
    due_at: row.dueAt,
    claimed_at: row.claimedAt,
    lease_expires_at: row.leaseExpiresAt,
    submitted_result_id: row.submittedResultId,
    deploy_generation: row.deployGeneration,
    version: row.version,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function snakeResult(row: PostgresCheckResultRecord): Record<string, unknown> {
  return {
    workspace_id: row.workspaceId,
    id: row.id,
    monitor_id: row.monitorId,
    job_id: row.jobId,
    probe_id: row.probeId,
    monitor_version: row.monitorRevision,
    schedule_slot: row.scheduleSlot,
    probe_class: row.probeClass,
    probe_location: row.probeLocation,
    probe_policy_hash: row.probePolicyHash,
    checked_at: row.checkedAt,
    status: row.status,
    latency_ms: row.latencyMs,
    status_code: row.statusCode,
    error: row.error,
    attempt_count: row.attemptCount,
    evidence_json: row.evidence ? JSON.stringify(row.evidence) : null,
    actor: row.actor,
    origin: row.origin,
    idempotency_key: row.idempotencyKey,
  };
}

function snakeSubmission(row: PostgresProbeSubmissionRecord): Record<string, unknown> {
  return {
    workspace_id: row.workspaceId,
    id: row.id,
    probe_id: row.probeId,
    job_id: row.jobId,
    monitor_id: row.monitorId,
    monitor_revision: row.monitorRevision,
    schedule_slot: row.scheduleSlot,
    probe_class: row.probeClass,
    probe_location: row.probeLocation,
    probe_policy_hash: row.probePolicyHash,
    payload_hash: row.payloadHash,
    check_result_id: row.checkResultId,
    nonce: row.nonce,
    checked_at: row.checkedAt,
    submitted_at: row.submittedAt,
  };
}

function snakeAudit(row: PostgresAuditEventRecord): Record<string, unknown> {
  return {
    workspace_id: row.workspaceId,
    id: row.id,
    action: row.action,
    resource_type: row.resourceType,
    resource_id: row.resourceId,
    message: row.message,
    metadata_json: JSON.stringify(row.metadata),
    actor: row.actor,
    origin: row.origin,
    idempotency_key: row.idempotencyKey,
    created_at: row.createdAt,
  };
}

function snakeTombstone(row: PostgresSyncTombstoneRecord): Record<string, unknown> {
  return {
    workspace_id: row.workspaceId,
    resource_type: row.resourceType,
    resource_id: row.resourceId,
    deleted_at: row.deletedAt,
    version: row.version,
    actor: row.actor,
    origin: row.origin,
    idempotency_key: row.idempotencyKey,
    metadata_json: JSON.stringify(row.metadata),
  };
}
