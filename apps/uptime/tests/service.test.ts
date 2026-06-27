import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UptimeService } from "../src/service.js";
import type { CheckAttemptResult, Monitor } from "../src/types.js";

const cleanup: string[] = [];

afterEach(() => {
  while (cleanup.length > 0) {
    rmSync(cleanup.pop()!, { recursive: true, force: true });
  }
});

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "open-uptime-"));
  cleanup.push(dir);
  return join(dir, "uptime.db");
}

test("creates monitors and records successful checks", async () => {
  const service = new UptimeService({
    dbPath: tempDb(),
    checkRunner: async (): Promise<CheckAttemptResult> => ({
      status: "up",
      latencyMs: 42,
      statusCode: 200,
      error: null,
    }),
  });

  const monitor = service.createMonitor({
    name: "api",
    kind: "http",
    url: "https://example.com/health",
    intervalSeconds: 30,
  });

  const result = await service.checkMonitor("api");
  const summary = service.summary();

  expect(monitor.status).toBe("unknown");
  expect(monitor.host).toBeNull();
  expect(monitor.port).toBeNull();
  expect(result.status).toBe("up");
  expect(result.latencyMs).toBe(42);
  expect(summary.totals.up).toBe(1);
  expect(summary.monitors[0].uptimePercent).toBe(100);
  expect(summary.monitors[0].averageLatencyMs).toBe(42);
  service.close();
});

test("opens and closes incidents around downtime", async () => {
  const outcomes: CheckAttemptResult[] = [
    { status: "down", latencyMs: 100, statusCode: 500, error: "unexpected status 500" },
    { status: "up", latencyMs: 25, statusCode: 200, error: null },
  ];
  const service = new UptimeService({
    dbPath: tempDb(),
    checkRunner: async () => outcomes.shift()!,
  });

  const monitor = service.createMonitor({ name: "site", kind: "http", url: "https://example.com" });
  const down = await service.checkMonitor(monitor.id);
  const openIncidents = service.listIncidents({ status: "open" });
  const up = await service.checkMonitor(monitor.id);
  const closedIncidents = service.listIncidents({ status: "closed" });

  expect(down.status).toBe("down");
  expect(openIncidents).toHaveLength(1);
  expect(openIncidents[0].reason).toBe("unexpected status 500");
  expect(up.status).toBe("up");
  expect(service.listIncidents({ status: "open" })).toHaveLength(0);
  expect(closedIncidents).toHaveLength(1);
  expect(closedIncidents[0].recoveryCheckId).toBe(up.id);
  service.close();
});

test("retries failed checks before recording final success", async () => {
  let attempts = 0;
  const service = new UptimeService({
    dbPath: tempDb(),
    checkRunner: async () => {
      attempts += 1;
      return attempts < 2
        ? { status: "down", latencyMs: 10, statusCode: null, error: "first failure" }
        : { status: "up", latencyMs: 12, statusCode: 200, error: null };
    },
  });

  service.createMonitor({ name: "retrying", kind: "http", url: "https://example.com", retryCount: 1 });
  const result = await service.checkMonitor("retrying");

  expect(result.status).toBe("up");
  expect(result.attemptCount).toBe(2);
  expect(service.listIncidents()).toHaveLength(0);
  service.close();
});

test("all retries failing records one down result and opens one incident", async () => {
  let attempts = 0;
  const service = new UptimeService({
    dbPath: tempDb(),
    checkRunner: async () => {
      attempts += 1;
      return { status: "down", latencyMs: 10, statusCode: 500, error: `failure ${attempts}` };
    },
  });

  service.createMonitor({ name: "down", kind: "http", url: "https://example.com", retryCount: 2 });
  const result = await service.checkMonitor("down");

  expect(result.status).toBe("down");
  expect(result.attemptCount).toBe(3);
  expect(service.listResults()).toHaveLength(1);
  expect(service.listIncidents({ status: "open" })).toHaveLength(1);
  service.close();
});

test("runDueChecks skips monitors that are not due", async () => {
  const checked: string[] = [];
  const service = new UptimeService({
    dbPath: tempDb(),
    checkRunner: async (monitor: Monitor) => {
      checked.push(monitor.name);
      return { status: "up", latencyMs: 1, statusCode: 200, error: null };
    },
  });

  service.createMonitor({ name: "fast", kind: "http", url: "https://example.com", intervalSeconds: 60 });
  await service.runDueChecks(new Date("2026-01-01T00:00:00.000Z"));
  await service.runDueChecks(new Date("2026-01-01T00:00:30.000Z"));

  expect(checked).toEqual(["fast"]);
  service.close();
});

test("runDueChecks skips a monitor already being checked", async () => {
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const service = new UptimeService({
    dbPath: tempDb(),
    checkRunner: async () => {
      calls += 1;
      await started;
      return { status: "up", latencyMs: 1, statusCode: 200, error: null };
    },
  });

  service.createMonitor({ name: "slow", kind: "http", url: "https://example.com", intervalSeconds: 1 });
  const first = service.runDueChecks(new Date("2026-01-01T00:00:00.000Z"));
  const second = await service.runDueChecks(new Date("2026-01-01T00:00:00.100Z"));
  release();
  const firstResults = await first;

  expect(second).toHaveLength(0);
  expect(firstResults).toHaveLength(1);
  expect(calls).toBe(1);
  expect(service.listResults()).toHaveLength(1);
  service.close();
});

test("overlapping due runs skip monitors checked by a newer run", async () => {
  let releaseSlow!: () => void;
  let startedSlow!: () => void;
  const slowReleased = new Promise<void>((resolve) => {
    releaseSlow = resolve;
  });
  const slowStarted = new Promise<void>((resolve) => {
    startedSlow = resolve;
  });
  const checked: string[] = [];
  const service = new UptimeService({
    dbPath: tempDb(),
    checkRunner: async (monitor: Monitor) => {
      checked.push(monitor.name);
      if (monitor.name === "a") {
        startedSlow();
        await slowReleased;
      }
      return { status: "up", latencyMs: 1, statusCode: 200, error: null };
    },
  });

  service.createMonitor({ name: "a", kind: "http", url: "https://example.com/a", intervalSeconds: 60 });
  service.createMonitor({ name: "b", kind: "http", url: "https://example.com/b", intervalSeconds: 60 });

  const first = service.runDueChecks(new Date("2026-01-01T00:00:00.000Z"));
  await slowStarted;
  const secondResults = await service.runDueChecks(new Date("2026-01-01T00:00:00.100Z"));
  releaseSlow();
  const firstResults = await first;

  expect(checked).toEqual(["a", "b"]);
  expect(firstResults).toHaveLength(1);
  expect(secondResults).toHaveLength(1);
  expect(service.listResults()).toHaveLength(2);
  service.close();
});

test("disabled monitors are excluded from listMonitors default and all checks", async () => {
  const service = new UptimeService({
    dbPath: tempDb(),
    checkRunner: async () => ({ status: "up", latencyMs: 1, statusCode: 200, error: null }),
  });

  service.createMonitor({ name: "disabled", kind: "http", url: "https://example.com", enabled: false });

  expect(service.listMonitors()).toHaveLength(0);
  expect(service.listMonitors({ includeDisabled: true })).toHaveLength(1);
  expect(await service.checkAll()).toHaveLength(0);
  expect(service.summary().totals.paused).toBe(1);
  await expect(service.checkMonitor("disabled")).rejects.toThrow("Monitor is disabled: disabled");
  service.close();
});

test("explicit dbPath does not create or require the default uptime home", () => {
  const previousHome = process.env.HASNA_UPTIME_HOME;
  process.env.HASNA_UPTIME_HOME = "/dev/null";
  try {
    const service = new UptimeService({ dbPath: ":memory:" });
    service.createMonitor({ name: "memory", kind: "http", url: "https://example.com" });
    expect(service.summary().totals.monitors).toBe(1);
    service.close();
  } finally {
    if (previousHome === undefined) delete process.env.HASNA_UPTIME_HOME;
    else process.env.HASNA_UPTIME_HOME = previousHome;
  }
});

test("monitor timing and retry settings are bounded", () => {
  const service = new UptimeService({ dbPath: tempDb() });

  expect(() => service.createMonitor({
    name: "interval",
    kind: "http",
    url: "https://example.com",
    intervalSeconds: 86_401,
  })).toThrow("intervalSeconds must be an integer from 1 to 86400");
  expect(() => service.createMonitor({
    name: "timeout",
    kind: "http",
    url: "https://example.com",
    timeoutMs: 60_001,
  })).toThrow("timeoutMs must be an integer from 1 to 60000");
  expect(() => service.createMonitor({
    name: "retries",
    kind: "http",
    url: "https://example.com",
    retryCount: 11,
  })).toThrow("retryCount must be an integer from 0 to 10");
  expect(service.createMonitor({
    name: "max",
    kind: "http",
    url: "https://example.com",
    intervalSeconds: 86_400,
    timeoutMs: 60_000,
    retryCount: 10,
  }).retryCount).toBe(10);
  service.close();
});

test("monitor updates persist normalized kind-specific fields", () => {
  const service = new UptimeService({ dbPath: tempDb() });
  service.createMonitor({
    name: " api ",
    kind: "http",
    url: " https://example.com/health ",
    method: "head",
    expectedStatus: 204,
  });

  const tcp = service.updateMonitor("api", {
    name: " db ",
    kind: "tcp",
    host: " 127.0.0.1 ",
    port: 5432,
  });

  expect(tcp.name).toBe("db");
  expect(tcp.kind).toBe("tcp");
  expect(tcp.url).toBeNull();
  expect(tcp.host).toBe("127.0.0.1");
  expect(tcp.port).toBe(5432);
  expect(tcp.method).toBe("HEAD");
  expect(tcp.expectedStatus).toBeNull();

  const http = service.updateMonitor("db", {
    kind: "http",
    url: "https://example.com/ready",
    method: "get",
    expectedStatus: 200,
  });

  expect(http.kind).toBe("http");
  expect(http.url).toBe("https://example.com/ready");
  expect(http.host).toBeNull();
  expect(http.port).toBeNull();
  expect(http.method).toBe("GET");
  expect(http.expectedStatus).toBe(200);
  service.close();
});

test("target updates reset observed status and make the monitor immediately due", async () => {
  const checkedUrls: string[] = [];
  const service = new UptimeService({
    dbPath: tempDb(),
    checkRunner: async (monitor: Monitor) => {
      checkedUrls.push(monitor.url ?? "");
      return { status: "up", latencyMs: 1, statusCode: 200, error: null };
    },
  });

  service.createMonitor({
    name: "api",
    kind: "http",
    url: "https://old.example/health",
    intervalSeconds: 3600,
  });
  await service.checkMonitor("api");

  const updated = service.updateMonitor("api", { url: "https://new.example/health" });
  expect(updated.status).toBe("unknown");
  expect(updated.lastCheckedAt).toBeNull();

  const due = await service.runDueChecks(new Date());
  expect(due).toHaveLength(1);
  expect(checkedUrls).toEqual(["https://old.example/health", "https://new.example/health"]);
  service.close();
});

test("monitor validation rejects invalid definitions", () => {
  const service = new UptimeService({ dbPath: tempDb() });

  expect(() => service.createMonitor({ name: "ftp", kind: "http", url: "ftp://example.com" })).toThrow("http or https");
  expect(() => service.createMonitor({ name: "host", kind: "tcp", host: "   ", port: 80 })).toThrow("TCP monitors require host");
  expect(() => service.createMonitor({ name: "status", kind: "http", url: "https://example.com", expectedStatus: 999 })).toThrow("expectedStatus");
  expect(() => service.createMonitor({ name: "method", kind: "http", url: "https://example.com", method: "GET /" })).toThrow("HTTP method");
  service.close();
});

test("monitors, results, and incidents persist after reopening the store", async () => {
  const dbPath = tempDb();
  const first = new UptimeService({
    dbPath,
    checkRunner: async () => ({ status: "down", latencyMs: 5, statusCode: 500, error: "boom" }),
  });
  first.createMonitor({ name: "persisted", kind: "http", url: "https://example.com" });
  await first.checkMonitor("persisted");
  first.close();

  const reopened = new UptimeService({ dbPath });
  expect(reopened.listMonitors({ includeDisabled: true })).toHaveLength(1);
  expect(reopened.listResults()).toHaveLength(1);
  expect(reopened.listIncidents({ status: "open" })).toHaveLength(1);
  reopened.close();
});
