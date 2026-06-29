import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UptimeService } from "../src/service.js";
import { runHostedPublicChecksWorker, runPostgresPublicProbeWorker, type PostgresPublicProbeRuntime } from "../src/workers.js";
import type { PostgresCheckJobRecord, PostgresMonitorRecord, SubmitPostgresProbeCheckResult } from "../src/postgres-runtime.js";
import type { CheckResult } from "../src/types.js";

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "open-uptime-workers-"));
  cleanup.push(dir);
  return join(dir, "uptime.db");
}

const cleanup: string[] = [];

afterEach(() => {
  for (const path of cleanup.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

test("hosted public checks worker is bounded and does not overlap ticks", async () => {
  let active = 0;
  let maxActive = 0;
  const calls: string[] = [];
  const runner = {
    async runDueHostedPublicChecks(now: Date, options?: { workspaceId?: string }): Promise<CheckResult[]> {
      active += 1;
      maxActive = Math.max(maxActive, active);
      calls.push(`${now.toISOString()} ${options?.workspaceId ?? "-"}`);
      await Promise.resolve();
      active -= 1;
      return [{
        id: `chk_${calls.length}`,
        workspaceId: "ws_worker",
        monitorId: "mon_1",
        jobId: null,
        probeId: null,
        monitorRevision: null,
        scheduleSlot: null,
        probeClass: null,
        probeLocation: null,
        probePolicyHash: null,
        checkedAt: now.toISOString(),
        status: "up",
        latencyMs: 1,
        statusCode: 200,
        error: null,
        attemptCount: 1,
        evidence: null,
      }];
    },
  };

  const summary = await runHostedPublicChecksWorker({
    runner,
    workspaceId: "ws_worker",
    intervalMs: 1,
    maxIterations: 3,
    sleep: async () => undefined,
    now: () => new Date(`2026-01-01T00:00:0${calls.length}.000Z`),
  });

  expect(summary).toMatchObject({
    kind: "open-uptime.hosted-public-checks-worker",
    status: "completed",
    workspaceId: "ws_worker",
    iterations: 3,
    checked: 3,
  });
  expect(maxActive).toBe(1);
  expect(calls).toEqual([
    "2026-01-01T00:00:00.000Z ws_worker",
    "2026-01-01T00:00:01.000Z ws_worker",
    "2026-01-01T00:00:02.000Z ws_worker",
  ]);
});

test("hosted public checks worker records one scoped result through the hosted service", async () => {
  const service = new UptimeService({
    mode: "hosted",
    hostedSqliteDbPath: tempDb(),
    allowHostedLocalStore: true,
    hostedResolveHost: async (hostname) => {
      if (hostname !== "example.com") throw new Error(`unexpected host ${hostname}`);
      return [{ address: "93.184.216.34", family: 4 }];
    },
    hostedHttpRequest: async () => ({ status: 200 }),
  });
  service.createMonitor({
    workspaceId: "ws_worker",
    name: "api",
    kind: "http",
    url: "https://example.com/health",
  });
  service.createMonitor({
    workspaceId: "ws_other",
    name: "other",
    kind: "http",
    url: "https://example.com/other",
  });

  const summary = await runHostedPublicChecksWorker({
    runner: service,
    workspaceId: "ws_worker",
    intervalMs: 1,
    maxIterations: 1,
    sleep: async () => undefined,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });

  expect(summary.checked).toBe(1);
  expect(service.listResults({ workspaceId: "ws_worker" })).toHaveLength(1);
  expect(service.listResults({ workspaceId: "ws_other" })).toHaveLength(0);
  service.close();
});

test("hosted public checks worker drains after abort", async () => {
  const abort = new AbortController();
  const summary = await runHostedPublicChecksWorker({
    runner: {
      async runDueHostedPublicChecks(): Promise<CheckResult[]> {
        abort.abort();
        return [];
      },
    },
    workspaceId: "ws_worker",
    intervalMs: 1,
    maxIterations: 10,
    signal: abort.signal,
    sleep: async () => undefined,
  });

  expect(summary.status).toBe("stopped");
  expect(summary.iterations).toBe(1);
});

test("postgres public-probe worker claims, runs hosted target-policy check, and submits result", async () => {
  const runtime = new FakePostgresPublicProbeRuntime();
  const summary = await runPostgresPublicProbeWorker({
    runtime,
    probeId: "prb_public",
    workspaceId: "ws_worker",
    limit: 5,
    maxJobs: 1,
    leaseTtlMs: 120_000,
    now: sequenceClock([
      "2026-06-29T10:00:00.000Z",
      "2026-06-29T10:00:05.000Z",
      "2026-06-29T10:00:06.000Z",
    ]),
    hostedResolveHost: async (hostname) => {
      expect(hostname).toBe("example.com");
      return [{ address: "93.184.216.34", family: 4 }];
    },
    hostedHttpRequest: async (context) => {
      expect(context.address.address).toBe("93.184.216.34");
      expect(context.url.toString()).toBe("https://example.com/health");
      return { status: 200 };
    },
  });

  expect(summary).toMatchObject({
    kind: "open-uptime.postgres-public-probe-worker",
    status: "completed",
    workspaceId: "ws_worker",
    probeId: "prb_public",
    discovered: 1,
    claimed: 1,
    submitted: 1,
    skipped: 0,
    failed: 0,
  });
  expect(runtime.submissions).toHaveLength(1);
  expect(runtime.submissions[0]!.payloadHash).toMatch(/^[a-f0-9]{64}$/);
  expect(runtime.submissions[0]!.nonce).toMatch(/^nonce_[a-f0-9]{48}$/);
  expect(runtime.submissions[0]!.evidence?.kind).toBe("http_target_policy");
  expect(runtime.submissions[0]!.actor).toBe("postgres-public-probe-worker");
  expect(summary.results[0]!.checkResultId).toMatch(/^chk_/);
});

test("postgres public-probe worker cancels stale monitor revision without running network", async () => {
  const runtime = new FakePostgresPublicProbeRuntime({
    monitor: {
      ...baseMonitor(),
      revision: 2,
    },
  });
  let requestCount = 0;

  const summary = await runPostgresPublicProbeWorker({
    runtime,
    probeId: "prb_public",
    workspaceId: "ws_worker",
    hostedHttpRequest: async () => {
      requestCount += 1;
      return { status: 200 };
    },
  });

  expect(summary.submitted).toBe(0);
  expect(summary.skipped).toBe(1);
  expect(summary.results[0]!.reason).toBe("monitor_revision_changed");
  expect(runtime.cancellations).toEqual([{ jobId: "job_due", probeId: "prb_public", reason: "monitor_revision_changed" }]);
  expect(requestCount).toBe(0);
});

test("postgres public-probe worker cancels unsupported monitor kinds without running network", async () => {
  const browserMonitor = {
    ...baseMonitor(),
    kind: "browser_page" as const,
    url: "https://example.com/page",
  };
  const runtime = new FakePostgresPublicProbeRuntime({
    monitor: browserMonitor,
    job: {
      ...baseJob(),
      monitorSnapshot: browserMonitor,
    },
  });
  let requestCount = 0;

  const summary = await runPostgresPublicProbeWorker({
    runtime,
    probeId: "prb_public",
    workspaceId: "ws_worker",
    hostedHttpRequest: async () => {
      requestCount += 1;
      return { status: 200 };
    },
  });

  expect(summary.submitted).toBe(0);
  expect(summary.skipped).toBe(1);
  expect(summary.results[0]!.reason).toBe("unsupported_monitor_kind");
  expect(runtime.cancellations).toEqual([{ jobId: "job_due", probeId: "prb_public", reason: "unsupported_monitor_kind" }]);
  expect(requestCount).toBe(0);
});

test("postgres public-probe worker reports partial status on failed job processing", async () => {
  const runtime = new FakePostgresPublicProbeRuntime();
  runtime.failSubmit = true;

  const summary = await runPostgresPublicProbeWorker({
    runtime,
    probeId: "prb_public",
    workspaceId: "ws_worker",
    hostedResolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
    hostedHttpRequest: async () => ({ status: 200 }),
  });

  expect(summary.status).toBe("partial");
  expect(summary.failed).toBe(1);
  expect(summary.results[0]!.action).toBe("failed");
  expect(summary.results[0]!.reason).toBe("submit failed");
});

test("postgres public-probe worker redacts per-job credential errors", async () => {
  const runtime = new FakePostgresPublicProbeRuntime();
  runtime.failSubmitMessage = "submit failed for postgres://svc:raw-password@db.example.invalid/app?token=secret Bearer raw-token";

  const summary = await runPostgresPublicProbeWorker({
    runtime,
    probeId: "prb_public",
    workspaceId: "ws_worker",
    hostedResolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
    hostedHttpRequest: async () => ({ status: 200 }),
  });

  expect(summary.status).toBe("partial");
  expect(summary.failed).toBe(1);
  expect(summary.results[0]!.action).toBe("failed");
  expect(summary.results[0]!.reason).toContain("postgres://[REDACTED]:[REDACTED]@db.example.invalid/app?token=redacted");
  expect(summary.results[0]!.reason).toContain("Bearer redacted");
  expect(summary.results[0]!.reason).not.toContain("raw-password");
  expect(summary.results[0]!.reason).not.toContain("raw-token");
});

test("postgres public-probe worker treats failed fenced cancellation as partial", async () => {
  const runtime = new FakePostgresPublicProbeRuntime({
    monitor: { ...baseMonitor(), revision: 2 },
  });
  runtime.cancelReturnsNull = true;

  const summary = await runPostgresPublicProbeWorker({
    runtime,
    probeId: "prb_public",
    workspaceId: "ws_worker",
    hostedResolveHost: async () => {
      throw new Error("network should not run");
    },
    hostedHttpRequest: async () => {
      throw new Error("request should not run");
    },
  });

  expect(summary.status).toBe("partial");
  expect(summary.failed).toBe(1);
  expect(summary.skipped).toBe(0);
  expect(summary.results[0]!.action).toBe("failed");
  expect(summary.results[0]!.reason).toBe("failed to cancel monitor_revision_changed job");
});

function sequenceClock(values: string[]): () => Date {
  let index = 0;
  return () => new Date(values[Math.min(index++, values.length - 1)]!);
}

function baseMonitor(): PostgresMonitorRecord {
  return {
    workspaceId: "ws_worker",
    id: "mon_homepage",
    name: "Homepage",
    kind: "http",
    url: "https://example.com/health",
    host: null,
    port: null,
    method: "GET",
    expectedStatus: 200,
    intervalSeconds: 60,
    timeoutMs: 5000,
    retryCount: 0,
    enabled: true,
    status: "unknown",
    lastCheckedAt: null,
    revision: 1,
    actor: null,
    origin: null,
    idempotencyKey: null,
    createdAt: "2026-06-29T09:59:00.000Z",
    updatedAt: "2026-06-29T09:59:00.000Z",
    deletedAt: null,
  };
}

function baseJob(): PostgresCheckJobRecord {
  return {
    workspaceId: "ws_worker",
    id: "job_due",
    monitorId: "mon_homepage",
    monitorRevision: 1,
    monitorSnapshot: baseMonitor(),
    scheduleSlot: "2026-06-29T10:00:00.000Z",
    probePolicy: { probeClass: "public", locations: ["us-east-1"] },
    probePolicyHash: "f".repeat(64),
    status: "pending",
    claimedByProbeId: null,
    fencingToken: null,
    dueAt: "2026-06-29T10:00:00.000Z",
    claimedAt: null,
    leaseExpiresAt: null,
    submittedResultId: null,
    deployGeneration: 0,
    version: 1,
    createdAt: "2026-06-29T09:59:00.000Z",
    updatedAt: "2026-06-29T09:59:00.000Z",
  };
}

class FakePostgresPublicProbeRuntime implements PostgresPublicProbeRuntime {
  monitor: PostgresMonitorRecord | null;
  job: PostgresCheckJobRecord;
  submissions: Array<Parameters<PostgresPublicProbeRuntime["submitProbeCheckResult"]>[0]> = [];
  cancellations: Array<{ jobId: string; probeId: string; reason: string | undefined }> = [];
  audits: Array<Record<string, unknown>> = [];
  failSubmit = false;
  failSubmitMessage: string | null = null;
  cancelReturnsNull = false;

  constructor(options: { monitor?: PostgresMonitorRecord | null; job?: PostgresCheckJobRecord } = {}) {
    this.monitor = options.monitor === undefined ? baseMonitor() : options.monitor;
    this.job = options.job ?? baseJob();
  }

  async listDueCheckJobs(): Promise<PostgresCheckJobRecord[]> {
    return [this.job];
  }

  async claimCheckJob(input: { jobId: string; probeId: string; leaseTtlMs?: number }): Promise<PostgresCheckJobRecord | null> {
    if (input.jobId !== this.job.id) return null;
    this.job = {
      ...this.job,
      status: "claimed",
      claimedByProbeId: input.probeId,
      fencingToken: "fence_worker",
      claimedAt: "2026-06-29T10:00:01.000Z",
      leaseExpiresAt: "2026-06-29T10:02:01.000Z",
    };
    return this.job;
  }

  async getMonitor(): Promise<PostgresMonitorRecord | null> {
    return this.monitor;
  }

  async submitProbeCheckResult(input: Parameters<PostgresPublicProbeRuntime["submitProbeCheckResult"]>[0]): Promise<SubmitPostgresProbeCheckResult> {
    if (this.failSubmitMessage) throw new Error(this.failSubmitMessage);
    if (this.failSubmit) throw new Error("submit failed");
    this.submissions.push(input);
    const result = {
      workspaceId: "ws_worker",
      id: `chk_${input.payloadHash.slice(0, 16)}`,
      monitorId: "mon_homepage",
      jobId: input.jobId,
      probeId: input.probeId,
      monitorRevision: 1,
      scheduleSlot: "2026-06-29T10:00:00.000Z",
      probeClass: "public" as const,
      probeLocation: "us-east-1",
      probePolicyHash: "f".repeat(64),
      checkedAt: input.checkedAt,
      status: input.status,
      latencyMs: input.latencyMs ?? null,
      statusCode: input.statusCode ?? null,
      error: input.error ?? null,
      attemptCount: input.attemptCount ?? 1,
      evidence: input.evidence ?? null,
      actor: input.actor ?? null,
      origin: input.origin ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
    };
    this.job = {
      ...this.job,
      status: "submitted",
      submittedResultId: result.id,
      fencingToken: null,
    };
    return {
      job: this.job,
      result,
      submission: {
        workspaceId: "ws_worker",
        id: `psb_${input.nonce.slice(0, 16)}`,
        probeId: input.probeId,
        jobId: input.jobId,
        monitorId: "mon_homepage",
        monitorRevision: 1,
        scheduleSlot: "2026-06-29T10:00:00.000Z",
        probeClass: "public",
        probeLocation: "us-east-1",
        probePolicyHash: "f".repeat(64),
        payloadHash: input.payloadHash,
        checkResultId: result.id,
        nonce: input.nonce,
        checkedAt: input.checkedAt,
        submittedAt: "2026-06-29T10:00:06.000Z",
      },
    };
  }

  async recordAuditEvent(input: Record<string, unknown>): Promise<void> {
    this.audits.push(input);
  }

  async cancelClaimedCheckJob(input: Parameters<NonNullable<PostgresPublicProbeRuntime["cancelClaimedCheckJob"]>>[0]): Promise<PostgresCheckJobRecord | null> {
    if (this.cancelReturnsNull) return null;
    if (input.fencingToken !== this.job.fencingToken) return null;
    this.cancellations.push({
      jobId: input.jobId,
      probeId: input.probeId,
      reason: input.reason ?? undefined,
    });
    this.job = { ...this.job, status: "cancelled", fencingToken: null, leaseExpiresAt: null };
    return this.job;
  }
}
