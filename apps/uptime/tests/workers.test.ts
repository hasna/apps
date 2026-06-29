import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UptimeService } from "../src/service.js";
import { runHostedPublicChecksWorker, runPostgresPublicProbeWorker, runPostgresSchedulerWorker, type PostgresPublicProbeRuntime, type PostgresSchedulerRuntime } from "../src/workers.js";
import type { CreatePostgresCheckJobInput, PostgresCheckJobRecord, PostgresMonitorRecord, SubmitPostgresProbeCheckResult } from "../src/postgres-runtime.js";
import type { CheckResult, ProbePolicy } from "../src/types.js";

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

test("postgres scheduler worker creates one deterministic public job across repeated runs", async () => {
  const runtime = new FakePostgresSchedulerRuntime({
    monitors: [{
      ...baseMonitor(),
      lastCheckedAt: "2026-06-29T09:59:00.000Z",
      intervalSeconds: 60,
    }],
  });
  const options = {
    runtime,
    workspaceId: "ws_worker",
    now: () => new Date("2026-06-29T10:00:17.000Z"),
    maxSlotsPerMonitor: 3,
    hostedResolveHost: async () => [{ address: "93.184.216.34", family: 4 as const }],
  };

  const first = await runPostgresSchedulerWorker(options);
  const second = await runPostgresSchedulerWorker(options);

  expect(first).toMatchObject({
    kind: "open-uptime.postgres-scheduler-worker",
    status: "completed",
    workspaceId: "ws_worker",
    discovered: 1,
    scheduled: 1,
    skipped: 0,
    failed: 0,
  });
  expect(first.results[0]!.scheduleSlots).toEqual(["2026-06-29T10:00:00.000Z"]);
  expect(first.results[0]!.jobIds).toHaveLength(1);
  expect(second.discovered).toBe(0);
  expect(second.scheduled).toBe(0);
  expect(runtime.jobs).toHaveLength(1);
  expect(runtime.jobs[0]!.probePolicy).toEqual({ probeClass: "public", locations: [] });
  expect(runtime.audits).toHaveLength(1);
});

test("postgres scheduler worker ignores open jobs for other probe policies", async () => {
  const monitor = {
    ...baseMonitor(),
    lastCheckedAt: "2026-06-29T09:59:00.000Z",
    intervalSeconds: 60,
  };
  const runtime = new FakePostgresSchedulerRuntime({ monitors: [monitor] });
  runtime.jobs.push({
    ...baseJob(),
    id: "job_private_existing",
    monitorId: monitor.id,
    monitorRevision: monitor.revision,
    monitorSnapshot: monitor,
    probePolicy: { probeClass: "private", locations: ["operator-02"] },
    probePolicyHash: "b".repeat(64),
    status: "pending",
    submittedResultId: null,
  });

  const summary = await runPostgresSchedulerWorker({
    runtime,
    workspaceId: "ws_worker",
    now: () => new Date("2026-06-29T10:00:17.000Z"),
    hostedResolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
  });

  expect(summary.discovered).toBe(1);
  expect(summary.scheduled).toBe(1);
  expect(runtime.jobs).toHaveLength(2);
  expect(runtime.jobs[1]!.probePolicy).toEqual({ probeClass: "public", locations: [] });
});

test("postgres scheduler worker blocks unsafe public targets before job creation", async () => {
  const runtime = new FakePostgresSchedulerRuntime({
    monitors: [{
      ...baseMonitor(),
      url: "https://public.example.test/health",
      lastCheckedAt: "2026-06-29T09:59:00.000Z",
    }],
  });

  const summary = await runPostgresSchedulerWorker({
    runtime,
    workspaceId: "ws_worker",
    now: () => new Date("2026-06-29T10:00:17.000Z"),
    hostedResolveHost: async () => [{ address: "10.0.0.1", family: 4 }],
  });

  expect(summary.status).toBe("completed");
  expect(summary.scheduled).toBe(0);
  expect(summary.skipped).toBe(1);
  expect(summary.results[0]!.reason).toContain("target_policy_blocked");
  expect(runtime.jobs).toHaveLength(0);
});

test("postgres scheduler worker paginates past blocked targets to schedule valid monitors", async () => {
  const runtime = new FakePostgresSchedulerRuntime({
    monitors: [
      {
        ...baseMonitor(),
        id: "mon_blocked",
        url: "https://blocked.example.test/health",
        lastCheckedAt: "2026-06-29T09:59:00.000Z",
      },
      {
        ...baseMonitor(),
        id: "mon_valid",
        url: "https://valid.example.test/health",
        lastCheckedAt: "2026-06-29T09:59:00.000Z",
      },
    ],
  });

  const summary = await runPostgresSchedulerWorker({
    runtime,
    workspaceId: "ws_worker",
    limit: 1,
    maxMonitors: 2,
    now: () => new Date("2026-06-29T10:00:17.000Z"),
    hostedResolveHost: async (hostname) => hostname === "blocked.example.test"
      ? [{ address: "10.0.0.1", family: 4 }]
      : [{ address: "93.184.216.34", family: 4 }],
  });

  expect(summary.discovered).toBe(2);
  expect(summary.scheduled).toBe(1);
  expect(summary.skipped).toBe(1);
  expect(summary.results.map((result) => result.monitorId)).toEqual(["mon_blocked", "mon_valid"]);
  expect(summary.results[0]!.reason).toContain("target_policy_blocked");
  expect(runtime.jobs).toHaveLength(1);
  expect(runtime.jobs[0]!.monitorId).toBe("mon_valid");
});

test("postgres scheduler worker defers unsafe targets so later runs can schedule safe monitors", async () => {
  const runtime = new FakePostgresSchedulerRuntime({
    monitors: [
      {
        ...baseMonitor(),
        id: "mon_blocked_a",
        url: "https://blocked-a.example.test/health",
        lastCheckedAt: "2026-06-29T09:59:00.000Z",
      },
      {
        ...baseMonitor(),
        id: "mon_blocked_b",
        url: "https://blocked-b.example.test/health",
        lastCheckedAt: "2026-06-29T09:59:00.000Z",
      },
      {
        ...baseMonitor(),
        id: "mon_valid",
        url: "https://valid.example.test/health",
        lastCheckedAt: "2026-06-29T09:59:00.000Z",
      },
    ],
  });
  const options = {
    runtime,
    workspaceId: "ws_worker",
    limit: 2,
    maxMonitors: 2,
    now: () => new Date("2026-06-29T10:00:17.000Z"),
    hostedResolveHost: async (hostname: string) => hostname.startsWith("blocked-")
      ? [{ address: "10.0.0.1", family: 4 as const }]
      : [{ address: "93.184.216.34", family: 4 as const }],
  };

  const first = await runPostgresSchedulerWorker(options);
  const second = await runPostgresSchedulerWorker(options);

  expect(first.discovered).toBe(2);
  expect(first.scheduled).toBe(0);
  expect(first.skipped).toBe(2);
  expect(second.discovered).toBe(1);
  expect(second.scheduled).toBe(1);
  expect(second.results[0]!.monitorId).toBe("mon_valid");
  expect(runtime.deferred.map((entry) => entry.monitorId)).toEqual(["mon_blocked_a", "mon_blocked_b"]);
});

test("postgres scheduler worker skips unsupported and wrong-workspace monitors", async () => {
  const runtime = new FakePostgresSchedulerRuntime({
    leakWorkspaces: true,
    monitors: [
      {
        ...baseMonitor(),
        kind: "browser_page",
        url: "https://example.com/page",
        lastCheckedAt: "2026-06-29T09:59:00.000Z",
      },
      {
        ...baseMonitor(),
        workspaceId: "ws_other",
        id: "mon_other",
        lastCheckedAt: "2026-06-29T09:59:00.000Z",
      },
    ],
  });

  const summary = await runPostgresSchedulerWorker({
    runtime,
    workspaceId: "ws_worker",
    now: () => new Date("2026-06-29T10:00:17.000Z"),
    hostedResolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
  });

  expect(summary.scheduled).toBe(0);
  expect(summary.skipped).toBe(2);
  expect(summary.results.map((result) => result.reason)).toEqual(["unsupported_monitor_kind", "workspace_mismatch"]);
  expect(runtime.jobs).toHaveLength(0);
});

test("postgres scheduler worker bounds catch-up slots deterministically", async () => {
  const runtime = new FakePostgresSchedulerRuntime({
    monitors: [{
      ...baseMonitor(),
      lastCheckedAt: "2026-06-29T09:55:00.000Z",
      intervalSeconds: 60,
    }],
  });

  const summary = await runPostgresSchedulerWorker({
    runtime,
    workspaceId: "ws_worker",
    now: () => new Date("2026-06-29T10:00:17.000Z"),
    maxSlotsPerMonitor: 2,
    catchupWindowMs: 120_000,
    hostedResolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
  });

  expect(summary.scheduled).toBe(2);
  expect(summary.results[0]!.scheduleSlots).toEqual([
    "2026-06-29T09:59:00.000Z",
    "2026-06-29T10:00:00.000Z",
  ]);
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

test("postgres public-probe worker rejects wrong-workspace discovery rows before claim", async () => {
  const runtime = new FakePostgresPublicProbeRuntime({
    job: { ...baseJob(), workspaceId: "ws_other" },
  });

  const summary = await runPostgresPublicProbeWorker({
    runtime,
    probeId: "prb_public",
    workspaceId: "ws_worker",
  });

  expect(summary.status).toBe("completed");
  expect(summary.claimed).toBe(0);
  expect(summary.skipped).toBe(1);
  expect(summary.results[0]!.reason).toBe("workspace_mismatch");
  expect(runtime.claims).toHaveLength(0);
  expect(runtime.submissions).toHaveLength(0);
});

test("postgres public-probe worker requests only public-policy jobs before claim", async () => {
  const runtime = new FakePostgresPublicProbeRuntime({
    job: {
      ...baseJob(),
      probePolicy: { probeClass: "private", locations: [] },
    },
  });

  const summary = await runPostgresPublicProbeWorker({
    runtime,
    probeId: "prb_public",
    workspaceId: "ws_worker",
  });

  expect(summary.status).toBe("completed");
  expect(summary.discovered).toBe(0);
  expect(summary.claimed).toBe(0);
  expect(summary.submitted).toBe(0);
  expect(summary.skipped).toBe(0);
  expect(runtime.listDueRequests).toEqual([{ workspaceId: "ws_worker", now: expect.any(String), limit: 10, probeClass: "public", probeId: "prb_public" }]);
  expect(runtime.claims).toHaveLength(0);
  expect(runtime.cancellations).toHaveLength(0);
  expect(runtime.submissions).toHaveLength(0);
});

test("postgres public-probe worker discovers only jobs claimable by the probe location", async () => {
  const runtime = new FakePostgresPublicProbeRuntime({
    jobs: [
      {
        ...baseJob(),
        id: "job_eu",
        probePolicy: { probeClass: "public", locations: ["eu-west-1"] },
      },
      {
        ...baseJob(),
        id: "job_us",
        probePolicy: { probeClass: "public", locations: ["us-east-1"] },
      },
    ],
  });

  const summary = await runPostgresPublicProbeWorker({
    runtime,
    probeId: "prb_public",
    workspaceId: "ws_worker",
    limit: 1,
    maxJobs: 1,
    hostedResolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
    hostedHttpRequest: async () => ({ status: 200 }),
  });

  expect(summary.discovered).toBe(1);
  expect(summary.claimed).toBe(1);
  expect(summary.submitted).toBe(1);
  expect(runtime.claims).toEqual([{ workspaceId: "ws_worker", jobId: "job_us", probeId: "prb_public", leaseTtlMs: 120_000 }]);
  expect(runtime.submissions[0]!.jobId).toBe("job_us");
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
  jobs: PostgresCheckJobRecord[];
  listDueRequests: Array<{ workspaceId?: string; now?: string; limit?: number; probeClass?: "public" | "private"; probeId?: string }> = [];
  claims: Array<{ workspaceId?: string; jobId: string; probeId: string; leaseTtlMs?: number }> = [];
  submissions: Array<Parameters<PostgresPublicProbeRuntime["submitProbeCheckResult"]>[0]> = [];
  cancellations: Array<{ jobId: string; probeId: string; reason: string | undefined }> = [];
  audits: Array<Record<string, unknown>> = [];
  failSubmit = false;
  failSubmitMessage: string | null = null;
  cancelReturnsNull = false;

  constructor(options: { monitor?: PostgresMonitorRecord | null; job?: PostgresCheckJobRecord; jobs?: PostgresCheckJobRecord[] } = {}) {
    this.monitor = options.monitor === undefined ? baseMonitor() : options.monitor;
    this.jobs = options.jobs ?? [options.job ?? baseJob()];
  }

  get job(): PostgresCheckJobRecord {
    return this.jobs[0]!;
  }

  set job(value: PostgresCheckJobRecord) {
    this.jobs = [value];
  }

  async listDueCheckJobs(options?: { workspaceId?: string; now?: string; limit?: number; probeClass?: "public" | "private"; probeId?: string }): Promise<PostgresCheckJobRecord[]> {
    this.listDueRequests.push(options ?? {});
    const probeClass = options?.probeId ? fakeProbeClass(options.probeId) : null;
    const probeLocation = options?.probeId ? fakeProbeLocation(options.probeId) : null;
    return this.jobs
      .filter((job) => !options?.probeClass || job.probePolicy.probeClass === options.probeClass)
      .filter((job) => !probeClass || job.probePolicy.probeClass === probeClass)
      .filter((job) => !probeLocation || job.probePolicy.locations.length === 0 || job.probePolicy.locations.includes(probeLocation))
      .slice(0, options?.limit ?? 50);
  }

  async claimCheckJob(input: { jobId: string; probeId: string; leaseTtlMs?: number }): Promise<PostgresCheckJobRecord | null> {
    this.claims.push(input);
    const jobIndex = this.jobs.findIndex((job) => job.id === input.jobId);
    if (jobIndex < 0) return null;
    const job = this.jobs[jobIndex]!;
    if (job.probePolicy.probeClass !== fakeProbeClass(input.probeId)) return null;
    const probeLocation = fakeProbeLocation(input.probeId);
    if (job.probePolicy.locations.length > 0 && !job.probePolicy.locations.includes(probeLocation)) return null;
    this.jobs[jobIndex] = {
      ...job,
      status: "claimed",
      claimedByProbeId: input.probeId,
      fencingToken: "fence_worker",
      claimedAt: "2026-06-29T10:00:01.000Z",
      leaseExpiresAt: "2026-06-29T10:02:01.000Z",
    };
    return this.jobs[jobIndex]!;
  }

  async getMonitor(): Promise<PostgresMonitorRecord | null> {
    return this.monitor;
  }

  async submitProbeCheckResult(input: Parameters<PostgresPublicProbeRuntime["submitProbeCheckResult"]>[0]): Promise<SubmitPostgresProbeCheckResult> {
    if (this.failSubmitMessage) throw new Error(this.failSubmitMessage);
    if (this.failSubmit) throw new Error("submit failed");
    this.submissions.push(input);
    const jobIndex = this.jobs.findIndex((job) => job.id === input.jobId);
    if (jobIndex < 0) throw new Error("job not found");
    const job = this.jobs[jobIndex]!;
    const result = {
      workspaceId: "ws_worker",
      id: `chk_${input.payloadHash.slice(0, 16)}`,
      monitorId: job.monitorId,
      jobId: input.jobId,
      probeId: input.probeId,
      monitorRevision: job.monitorRevision,
      scheduleSlot: job.scheduleSlot,
      probeClass: "public" as const,
      probeLocation: "us-east-1",
      probePolicyHash: job.probePolicyHash,
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
    this.jobs[jobIndex] = {
      ...job,
      status: "submitted",
      submittedResultId: result.id,
      fencingToken: null,
    };
    return {
      job: this.jobs[jobIndex]!,
      result,
      submission: {
        workspaceId: "ws_worker",
        id: `psb_${input.nonce.slice(0, 16)}`,
        probeId: input.probeId,
        jobId: input.jobId,
        monitorId: job.monitorId,
        monitorRevision: job.monitorRevision,
        scheduleSlot: job.scheduleSlot,
        probeClass: "public",
        probeLocation: "us-east-1",
        probePolicyHash: job.probePolicyHash,
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
    const jobIndex = this.jobs.findIndex((job) => job.id === input.jobId);
    if (jobIndex < 0) return null;
    const job = this.jobs[jobIndex]!;
    if (input.fencingToken !== job.fencingToken) return null;
    this.cancellations.push({
      jobId: input.jobId,
      probeId: input.probeId,
      reason: input.reason ?? undefined,
    });
    this.jobs[jobIndex] = { ...job, status: "cancelled", fencingToken: null, leaseExpiresAt: null };
    return this.jobs[jobIndex]!;
  }
}

function fakeProbeClass(probeId: string): "public" | "private" {
  return probeId.includes("private") ? "private" : "public";
}

function fakeProbeLocation(probeId: string): string {
  if (probeId.includes("eu")) return "eu-west-1";
  return "us-east-1";
}

class FakePostgresSchedulerRuntime implements PostgresSchedulerRuntime {
  monitors: PostgresMonitorRecord[];
  jobs: PostgresCheckJobRecord[] = [];
  audits: Array<Record<string, unknown>> = [];
  deferred: Array<{ monitorId: string; monitorRevision: number; deferredAt?: string; reason?: string | null }> = [];
  leakWorkspaces: boolean;

  constructor(options: { monitors?: PostgresMonitorRecord[]; leakWorkspaces?: boolean } = {}) {
    this.monitors = options.monitors ?? [baseMonitor()];
    this.leakWorkspaces = options.leakWorkspaces ?? false;
  }

  async listSchedulerMonitors(options?: { workspaceId?: string; now?: string; limit?: number; cursor?: { sortAt: string; id: string }; probePolicy?: ProbePolicy }): Promise<PostgresMonitorRecord[]> {
    const now = Date.parse(options?.now ?? "2026-06-29T10:00:00.000Z");
    return this.monitors
      .filter((monitor) => this.leakWorkspaces || !options?.workspaceId || monitor.workspaceId === options.workspaceId)
      .filter((monitor) => monitor.enabled && !monitor.deletedAt)
      .filter((monitor) => monitor.kind === "http" || monitor.kind === "tcp" || this.leakWorkspaces)
      .filter((monitor) => {
        const lastChecked = monitor.lastCheckedAt ? Date.parse(monitor.lastCheckedAt) : Number.NaN;
        return !Number.isFinite(lastChecked) || lastChecked + (monitor.intervalSeconds * 1000) <= now;
      })
      .sort((left, right) => schedulerFakeSortValue(left).localeCompare(schedulerFakeSortValue(right)) || left.id.localeCompare(right.id))
      .filter((monitor) => {
        if (!options?.cursor) return true;
        const sortAt = schedulerFakeSortValue(monitor);
        return sortAt > options.cursor.sortAt || (sortAt === options.cursor.sortAt && monitor.id > options.cursor.id);
      })
      .filter((monitor) => !this.jobs.some((job) =>
        job.workspaceId === monitor.workspaceId
        && job.monitorId === monitor.id
        && job.monitorRevision === monitor.revision
        && job.submittedResultId === null
        && (job.status === "pending" || job.status === "claimed" || job.status === "expired")
        && (!options?.probePolicy || sameProbePolicy(job.probePolicy, options.probePolicy))
      ))
      .slice(0, options?.limit ?? 50);
  }

  async createCheckJob(input: CreatePostgresCheckJobInput): Promise<PostgresCheckJobRecord> {
    const workspaceId = input.workspaceId ?? "ws_worker";
    const monitor = this.monitors.find((candidate) =>
      candidate.workspaceId === workspaceId
      && candidate.id === input.monitorId
      && candidate.revision === input.monitorRevision
      && candidate.enabled
      && !candidate.deletedAt
    );
    if (!monitor) throw new Error("monitor snapshot not found");
    const probePolicy = input.probePolicy ?? { probeClass: "private", locations: [] };
    const key = [
      workspaceId,
      input.monitorId,
      String(input.monitorRevision),
      input.scheduleSlot,
      probePolicy.probeClass,
      ...probePolicy.locations,
    ].join("|");
    const existing = this.jobs.find((job) => (job as PostgresCheckJobRecord & { testKey?: string }).testKey === key);
    if (existing) return existing;
    const job: PostgresCheckJobRecord & { testKey?: string } = {
      ...baseJob(),
      workspaceId,
      id: `job_scheduler_${this.jobs.length + 1}`,
      monitorId: input.monitorId,
      monitorRevision: input.monitorRevision,
      monitorSnapshot: monitor,
      scheduleSlot: input.scheduleSlot,
      dueAt: input.dueAt ?? input.scheduleSlot,
      probePolicy,
      probePolicyHash: "a".repeat(64),
      testKey: key,
    };
    this.jobs.push(job);
    return job;
  }

  async deferSchedulerMonitor(input: Parameters<NonNullable<PostgresSchedulerRuntime["deferSchedulerMonitor"]>>[0]): Promise<PostgresMonitorRecord | null> {
    const index = this.monitors.findIndex((monitor) =>
      monitor.workspaceId === (input.workspaceId ?? "ws_worker")
      && monitor.id === input.monitorId
      && monitor.revision === input.monitorRevision
      && monitor.enabled
      && !monitor.deletedAt
    );
    if (index < 0) return null;
    this.deferred.push({
      monitorId: input.monitorId,
      monitorRevision: input.monitorRevision,
      deferredAt: input.deferredAt,
      reason: input.reason ?? null,
    });
    const monitor = this.monitors[index]!;
    this.monitors[index] = {
      ...monitor,
      lastCheckedAt: input.deferredAt ?? monitor.lastCheckedAt,
      updatedAt: input.deferredAt ?? monitor.updatedAt,
    };
    return this.monitors[index]!;
  }

  async recordAuditEvent(input: Record<string, unknown>): Promise<void> {
    this.audits.push(input);
  }
}

function schedulerFakeSortValue(monitor: PostgresMonitorRecord): string {
  return monitor.lastCheckedAt ?? monitor.createdAt;
}

function sameProbePolicy(left: ProbePolicy, right: ProbePolicy): boolean {
  return left.probeClass === right.probeClass
    && [...left.locations].sort().join("\n") === [...right.locations].sort().join("\n");
}
