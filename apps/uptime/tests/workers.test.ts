import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UptimeService } from "../src/service.js";
import { runHostedPublicChecksWorker } from "../src/workers.js";
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
