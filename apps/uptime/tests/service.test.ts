import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { runMonitorCheck } from "../src/checks.js";
import { UptimeService } from "../src/service.js";
import { UptimeStore } from "../src/store.js";
import type { BrowserPageEvidence, CheckAttemptResult, CheckResult, Monitor } from "../src/types.js";

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

function expectBrowserEvidence(result: CheckResult): BrowserPageEvidence {
  if (result.evidence?.kind !== "browser_page") throw new Error("expected browser page evidence");
  return result.evidence;
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

test("cross-service due checks skip DB-leased monitors already in progress", async () => {
  const dbPath = tempDb();
  let release!: () => void;
  let started!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  let calls = 0;
  const first = new UptimeService({
    dbPath,
    checkRunner: async () => {
      calls += 1;
      started();
      await released;
      return { status: "up", latencyMs: 1, statusCode: 200, error: null };
    },
  });
  const second = new UptimeService({
    dbPath,
    checkRunner: async () => {
      calls += 1;
      return { status: "up", latencyMs: 1, statusCode: 200, error: null };
    },
  });

  first.createMonitor({ name: "shared", kind: "http", url: "https://example.com", intervalSeconds: 1 });
  const running = first.runDueChecks(new Date("2026-01-01T00:00:00.000Z"));
  await startedPromise;
  const skipped = await second.runDueChecks(new Date("2026-01-01T00:00:00.100Z"));
  release();
  const finished = await running;

  expect(skipped).toHaveLength(0);
  expect(finished).toHaveLength(1);
  expect(calls).toBe(1);
  expect(second.listResults()).toHaveLength(1);
  first.close();
  second.close();
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

test("stale in-flight checks do not overwrite updated monitor targets", async () => {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const service = new UptimeService({
    dbPath: tempDb(),
    checkRunner: async () => {
      await released;
      return { status: "up", latencyMs: 1, statusCode: 200, error: null };
    },
  });

  service.createMonitor({ name: "api", kind: "http", url: "https://old.example/health" });
  const running = service.checkMonitor("api");
  service.updateMonitor("api", { url: "https://new.example/health" });
  release();

  await expect(running).rejects.toThrow("Monitor changed while check was in progress");
  const monitor = service.getMonitor("api")!;
  expect(monitor.url).toBe("https://new.example/health");
  expect(monitor.status).toBe("unknown");
  expect(monitor.lastCheckedAt).toBeNull();
  expect(service.listResults()).toHaveLength(0);
  service.close();
});

test("same-millisecond monitor updates still invalidate stale in-flight checks", async () => {
  const RealDate = Date;
  const fixed = "2026-01-01T00:00:00.000Z";
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    globalThis.Date = class extends RealDate {
      constructor(value?: string | number | Date) {
        if (arguments.length === 0) super(fixed);
        else super(value as string | number | Date);
      }
      static now() {
        return new RealDate(fixed).getTime();
      }
    } as DateConstructor;
    const service = new UptimeService({
      dbPath: tempDb(),
      checkRunner: async () => {
        await released;
        return { status: "up", latencyMs: 1, statusCode: 200, error: null };
      },
    });

    service.createMonitor({ name: "api", kind: "http", url: "https://old.example/health" });
    const running = service.checkMonitor("api");
    service.updateMonitor("api", { url: "https://new.example/health" });
    release();

    await expect(running).rejects.toThrow("Monitor changed while check was in progress");
    expect(service.getMonitor("api")!.revision).toBe(2);
    expect(service.listResults()).toHaveLength(0);
    service.close();
  } finally {
    globalThis.Date = RealDate;
  }
});

test("pausing during an in-flight check does not write stale results or incidents", async () => {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const service = new UptimeService({
    dbPath: tempDb(),
    checkRunner: async () => {
      await released;
      return { status: "down", latencyMs: 1, statusCode: 500, error: "down" };
    },
  });

  service.createMonitor({ name: "api", kind: "http", url: "https://example.com" });
  const running = service.checkMonitor("api");
  service.updateMonitor("api", { enabled: false });
  release();

  await expect(running).rejects.toThrow("Monitor changed while check was in progress");
  const monitor = service.getMonitor("api")!;
  expect(monitor.enabled).toBe(false);
  expect(monitor.status).toBe("paused");
  expect(service.listResults()).toHaveLength(0);
  expect(service.listIncidents({ status: "open" })).toHaveLength(0);
  service.close();
});

test("target updates close old open incidents without marking them recovered", async () => {
  const service = new UptimeService({
    dbPath: tempDb(),
    checkRunner: async () => ({ status: "down", latencyMs: 1, statusCode: 500, error: "old target down" }),
  });

  service.createMonitor({ name: "api", kind: "http", url: "https://old.example/health" });
  await service.checkMonitor("api");
  expect(service.listIncidents({ status: "open" })).toHaveLength(1);

  service.updateMonitor("api", { url: "https://new.example/health" });
  const open = service.listIncidents({ status: "open" });
  const closed = service.listIncidents({ status: "closed" });

  expect(open).toHaveLength(0);
  expect(closed).toHaveLength(1);
  expect(closed[0].recoveryCheckId).toBeNull();
  service.close();
});

test("monitor validation rejects invalid definitions", () => {
  const service = new UptimeService({ dbPath: tempDb() });

  expect(() => service.createMonitor({ name: "ftp", kind: "http", url: "ftp://example.com" })).toThrow("http or https");
  expect(() => service.createMonitor({ name: "host", kind: "tcp", host: "   ", port: 80 })).toThrow("TCP monitors require host");
  expect(() => service.createMonitor({ name: "status", kind: "http", url: "https://example.com", expectedStatus: 999 })).toThrow("expectedStatus");
  expect(() => service.createMonitor({ name: "method", kind: "http", url: "https://example.com", method: "GET /" })).toThrow("HTTP method");
  expect(() => service.createMonitor({ name: "bad\nname", kind: "http", url: "https://example.com" })).toThrow("control characters");
  expect(() => service.createMonitor({ name: "enabled", kind: "http", url: "https://example.com", enabled: 0 as unknown as boolean })).toThrow("enabled must be a boolean");
  service.close();
});

test("summary counts all open incidents without result-list caps", () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const monitor = service.createMonitor({ name: "m", kind: "http", url: "https://example.com" });
  const db = (service.store as unknown as { db: any }).db;
  const insert = db.transaction(() => {
    for (let i = 0; i < 1001; i += 1) {
      db.query(`
        INSERT INTO incidents (
          id, monitor_id, status, opened_at, closed_at, last_failure_at,
          failure_count, recovery_check_id, reason
        ) VALUES (?, ?, 'open', ?, NULL, ?, 1, NULL, 'down')
      `).run(`inc_${i}`, monitor.id, `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}.000Z`, "2026-01-01T00:00:00.000Z");
    }
  });
  insert();

  expect(service.summary().totals.openIncidents).toBe(1001);
  service.close();
});

test("listIncidents still clamps large result requests", () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const monitor = service.createMonitor({ name: "m", kind: "http", url: "https://example.com" });
  const db = (service.store as unknown as { db: any }).db;
  const insert = db.transaction(() => {
    for (let i = 0; i < 1001; i += 1) {
      db.query(`
        INSERT INTO incidents (
          id, monitor_id, status, opened_at, closed_at, last_failure_at,
          failure_count, recovery_check_id, reason
        ) VALUES (?, ?, 'open', ?, NULL, ?, 1, NULL, 'down')
      `).run(`inc_${i}`, monitor.id, `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}.000Z`, "2026-01-01T00:00:00.000Z");
    }
  });
  insert();

  expect(service.listIncidents({ status: "open", limit: 5000 })).toHaveLength(1000);
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

test("hosted store fails closed without cloud adapter or explicit fallback", () => {
  const dbPath = tempDb();

  expect(() => new UptimeService({ dbPath, mode: "hosted" }))
    .toThrow("hosted mode requires HASNA_UPTIME_HOSTED_SQLITE_DB");
  expect(existsSync(dbPath)).toBe(false);
});

test("hosted store does not silently use SQLite when a cloud database URL is configured", () => {
  expect(() => new UptimeService({
    dbPath: tempDb(),
    mode: "hosted",
    allowHostedLocalStore: true,
    cloudDatabaseUrl: "postgres://example.invalid/uptime",
  })).toThrow("hosted Postgres adapter is not implemented yet");
});

test("hosted store allows non-standard SQLite paths only with explicit local fallback flag", () => {
  const dir = mkdtempSync(join(tmpdir(), "open-uptime-hosted-sqlite-"));
  cleanup.push(dir);
  const hostedSqliteDbPath = join(dir, "data", "uptime.db");
  const service = new UptimeService({ mode: "hosted", hostedSqliteDbPath, allowHostedLocalStore: true });
  try {
    expect(service.store.mode).toBe("hosted");
    expect(service.store.dataMode).toBe("hosted-local-sqlite");
    expect(service.store.dbPath).toBe(hostedSqliteDbPath);
    const monitor = service.createMonitor({ name: "cloud", kind: "http", url: "https://example.com" });
    expect(monitor.status).toBe("unknown");
  } finally {
    service.close();
  }

  const reopened = new UptimeService({ mode: "hosted", hostedSqliteDbPath, allowHostedLocalStore: true });
  try {
    expect(reopened.listMonitors({ includeDisabled: true }).map((monitor) => monitor.name)).toEqual(["cloud"]);
  } finally {
    reopened.close();
  }
});

test("hosted cloud-mounted SQLite path must be absolute", () => {
  expect(() => new UptimeService({ mode: "hosted", hostedSqliteDbPath: "relative/uptime.db" }))
    .toThrow("HASNA_UPTIME_HOSTED_SQLITE_DB must be an absolute path");
  expect(() => new UptimeService({ mode: "hosted", hostedSqliteDbPath: ":memory:" }))
    .toThrow("HASNA_UPTIME_HOSTED_SQLITE_DB must be an absolute path");
  const dir = mkdtempSync(join(tmpdir(), "open-uptime-hosted-bad-path-"));
  cleanup.push(dir);
  expect(() => new UptimeService({ mode: "hosted", hostedSqliteDbPath: join(dir, "uptime.db") }))
    .toThrow("HASNA_UPTIME_HOSTED_SQLITE_DB must be /data/uptime/uptime.db");
});

test("hosted EFS SQLite refuses the approved path when it is not an EFS mount", () => {
  expect(() => new UptimeService({ mode: "hosted", hostedSqliteDbPath: "/data/uptime/uptime.db" }))
    .toThrow("must be on a mounted EFS/NFS filesystem");
});

test("default service construction stays local when hosted env vars are set", () => {
  const dir = mkdtempSync(join(tmpdir(), "open-uptime-env-"));
  cleanup.push(dir);
  const previousMode = process.env.HASNA_UPTIME_MODE;
  const previousToken = process.env.HASNA_UPTIME_HOSTED_TOKEN;
  const previousDb = process.env.HASNA_UPTIME_DB;
  process.env.HASNA_UPTIME_MODE = "hosted";
  process.env.HASNA_UPTIME_HOSTED_TOKEN = "hosted-secret";
  process.env.HASNA_UPTIME_DB = join(dir, "uptime.db");
  try {
    const service = new UptimeService();
    expect(service.store.mode).toBe("local");
    expect(service.store.dataMode).toBe("local-sqlite");
    service.createMonitor({ name: "local-default", kind: "http", url: "https://example.com" });
    expect(service.summary().totals.monitors).toBe(1);
    service.close();

    const store = new UptimeStore();
    expect(store.mode).toBe("local");
    expect(store.dataMode).toBe("local-sqlite");
    store.close();
  } finally {
    if (previousMode === undefined) delete process.env.HASNA_UPTIME_MODE;
    else process.env.HASNA_UPTIME_MODE = previousMode;
    if (previousToken === undefined) delete process.env.HASNA_UPTIME_HOSTED_TOKEN;
    else process.env.HASNA_UPTIME_HOSTED_TOKEN = previousToken;
    if (previousDb === undefined) delete process.env.HASNA_UPTIME_DB;
    else process.env.HASNA_UPTIME_DB = previousDb;
  }
});

test("hosted service rejects inline SDK checks and scheduler entrypoints", async () => {
  let calls = 0;
  const service = new UptimeService({
    dbPath: tempDb(),
    mode: "hosted",
    allowHostedLocalStore: true,
    checkRunner: async () => {
      calls += 1;
      return { status: "up", latencyMs: 1, statusCode: 200, error: null };
    },
  });
  service.createMonitor({ name: "hosted", kind: "http", url: "https://example.com" });

  await expect(service.checkMonitor("hosted")).rejects.toThrow("hosted checks require check_jobs and probes");
  await expect(service.checkAll()).rejects.toThrow("hosted checks require check_jobs and probes");
  await expect(service.runDueChecks()).rejects.toThrow("hosted checks require check_jobs and probes");
  expect(() => service.startScheduler()).toThrow("hosted scheduler requires check_jobs and probes");
  expect(calls).toBe(0);
  service.close();
});

test("hosted service rejects IPv4-mapped IPv6 private targets", () => {
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  expect(() => service.createMonitor({ name: "mapped-loopback", kind: "http", url: "http://[::ffff:7f00:1]/" }))
    .toThrow("private or reserved IPv6");
  expect(() => service.createMonitor({ name: "mapped-private", kind: "http", url: "http://[::ffff:a00:1]/" }))
    .toThrow("private or reserved IPv6");
  expect(() => service.createMonitor({ name: "mapped-metadata", kind: "http", url: "http://[::ffff:a9fe:a9fe]/" }))
    .toThrow("private or reserved IPv6");
  expect(() => service.createMonitor({ name: "mapped-tcp", kind: "tcp", host: "::ffff:c0a8:1", port: 5432 }))
    .toThrow("private or reserved IPv6");
  expect(service.summary().totals.monitors).toBe(0);
  service.close();
});

test("direct monitor creation keeps browser_page behind the import path", () => {
  const service = new UptimeService({ dbPath: tempDb() });

  expect(() => service.createMonitor({ name: "page", kind: "browser_page", url: "https://example.com" } as never))
    .toThrow("browser_page monitors must be imported");
  service.close();
});

test("import preview/apply is dry-run, idempotent, and stores browser evidence metadata", async () => {
  const dbPath = tempDb();
  const service = new UptimeService({
    dbPath,
    checkRunner: (monitor) => runMonitorCheck(monitor, {
      browserPage: async () => ({
        finalUrl: "https://example.com/app?token=secret",
        navigationStatus: 200,
        consoleErrors: [],
        pageErrors: [],
        failedRequests: [],
        screenshot: {
          ref: "artifact://screenshots/home",
          sha256: "b".repeat(64),
          bytes: 120,
          contentType: "image/png",
        },
      }),
    }),
  });

  const request = {
    source: "manual" as const,
    records: [{
      sourceId: "home-page",
      monitor: { name: "home page", kind: "browser_page", url: "https://example.com/app?api_key=secret" },
      localPath: "/Users/example/private/project",
      secretToken: "secret",
    }],
  };
  const preview = service.previewImport(request);
  expect(preview.totals).toMatchObject({ create: 1 });
  expect(service.summary().totals.monitors).toBe(0);

  const applied = service.applyImport(request);
  expect(applied.totals).toMatchObject({ create: 1 });
  expect(service.getMonitor("home page")?.kind).toBe("browser_page");

  const second = service.applyImport(request);
  expect(second.totals).toMatchObject({ unchanged: 1 });

  const result = await service.checkMonitor("home page");
  const resultEvidence = expectBrowserEvidence(result);
  expect(resultEvidence.screenshot?.ref).toBe("artifact://screenshots/home");
  expect(resultEvidence.finalUrl).toBe("https://example.com/app?token=%5Bredacted%5D");
  service.close();

  const reopened = new UptimeService({ dbPath });
  const stored = reopened.listResults({ limit: 1 })[0];
  expect(expectBrowserEvidence(stored).screenshot?.bytes).toBe(120);
  const rolledBack = reopened.rollbackImport(applied.batchId);
  expect(rolledBack.items[0].action).toBe("disabled");
  expect(reopened.getMonitor("home page")?.enabled).toBe(false);
  expect(reopened.listResults()).toHaveLength(1);
  reopened.close();
});

test("legacy monitor tables are migrated before browser_page imports", () => {
  const dbPath = tempDb();
  const db = new Database(dbPath, { create: true });
  db.run(`
    CREATE TABLE monitors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK (kind IN ('http', 'tcp')),
      url TEXT,
      host TEXT,
      port INTEGER,
      method TEXT NOT NULL DEFAULT 'GET',
      expected_status INTEGER,
      interval_seconds INTEGER NOT NULL DEFAULT 60,
      timeout_ms INTEGER NOT NULL DEFAULT 5000,
      retry_count INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'unknown',
      last_checked_at TEXT,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.close();

  const service = new UptimeService({ dbPath });
  const applied = service.applyImport({
    source: "manual",
    records: [{ sourceId: "page", monitor: { name: "page", kind: "browser_page", url: "https://example.com" } }],
  });

  expect(applied.totals.create).toBe(1);
  expect(service.getMonitor("page")?.kind).toBe("browser_page");
  service.close();
});

test("import mappings cover projects, servers, domains, and deployment sources", () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const cases = [
    {
      source: "projects" as const,
      sourceId: "proj_api",
      record: { id: "proj_api", name: "Project API", url: "https://project.example/health", path: "/Users/example/private/project", apiToken: "secret" },
      expected: { kind: "http", url: "https://project.example/health" },
    },
    {
      source: "servers" as const,
      sourceId: "srv_db",
      record: { id: "srv_db", name: "DB Server", kind: "tcp", hostname: "db.example.com", port: 5432 },
      expected: { kind: "tcp", host: "db.example.com", port: 5432 },
    },
    {
      source: "domains" as const,
      sourceId: "dom_example",
      record: { id: "dom_example", domain: "example.org" },
      expected: { kind: "http", url: "https://example.org/" },
    },
    {
      source: "deployment" as const,
      sourceId: "dep_prod",
      record: { id: "dep_prod", name: "Production", environmentUrl: "https://deploy.example" },
      expected: { kind: "http", url: "https://deploy.example/" },
    },
  ];

  for (const item of cases) {
    const preview = service.previewImport({ source: item.source, records: [item.record] });
    expect(preview.totals.create).toBe(1);
    const applied = service.applyImport({ source: item.source, records: [item.record] });
    expect(applied.totals.create).toBe(1);
    const monitor = applied.items[0].after!;
    expect(monitor).toMatchObject(item.expected);
    expect(service.applyImport({ source: item.source, records: [item.record] }).totals.unchanged).toBe(1);
    const provenance = service.store.getProvenance(item.source, item.sourceId);
    expect(provenance?.monitorId).toBe(monitor.id);
    expect(JSON.stringify(provenance?.snapshot)).not.toContain("/Users/example/private");
    expect(JSON.stringify(provenance?.snapshot)).not.toContain("secret");
  }
  service.close();
});

test("domain imports are idempotent after URL normalization and bare domains get unique source ids", () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const request = {
    source: "domains" as const,
    records: [{ domain: "example.org" }, { domain: "example.net" }],
  };

  const applied = service.applyImport(request);
  const second = service.applyImport(request);

  expect(applied.totals.create).toBe(2);
  expect(second.totals.unchanged).toBe(2);
  expect(service.summary().totals.monitors).toBe(2);
  expect(service.store.getProvenance("domains", "domains:https://example.org/")?.monitorId).toBeTruthy();
  expect(service.store.getProvenance("domains", "domains:https://example.net/")?.monitorId).toBeTruthy();
  service.close();
});

test("URL-only import records use normalized fallback identity", () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const request = {
    source: "manual" as const,
    records: [
      { url: "https://example.com" },
      { url: "https://example.com/" },
    ],
  };

  const preview = service.previewImport(request);
  const applied = service.applyImport(request);

  expect(preview.totals).toMatchObject({ create: 1, conflict: 1 });
  expect(applied.totals).toMatchObject({ create: 1, conflict: 1 });
  expect(service.summary().totals.monitors).toBe(1);
  expect(service.store.getProvenance("manual", "manual:https://example.com/")?.monitorId).toBeTruthy();
  service.close();
});

test("TCP imports preserve live target hosts while hosted fallback redacts private hosts", () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const applied = service.applyImport({
    source: "servers",
    records: [{ id: "db", name: "db", kind: "tcp", hostname: "db.internal", port: 5432 }],
  });

  expect(applied.totals.create).toBe(1);
  expect(applied.items[0].after?.host).toBe("db.internal");
  service.close();

  const hosted = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  const preview = hosted.previewImport({
    source: "servers",
    records: [{ id: "db", name: "db", kind: "tcp", hostname: "db.internal", port: 5432 }],
  });
  expect(preview.totals.blocked).toBe(1);
  expect(preview.items[0].candidate.host).toBe("[private-host]");
  expect(JSON.stringify(preview)).not.toContain("db.internal");
  hosted.close();
});

test("URL-only import records redact secret params in generated identity", () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const request = {
    source: "manual" as const,
    records: [{ url: "https://example.com/?api_key=secret" }],
  };

  const preview = service.previewImport(request);
  const applied = service.applyImport(request);

  expect(preview.totals.create).toBe(1);
  expect(preview.items[0].candidate.sourceId).toBe("manual:https://example.com/?api_key=%5Bredacted%5D");
  expect(preview.items[0].candidate.name).toBe("manual-https://example.com/?api_key=%5Bredacted%5D");
  expect(JSON.stringify(preview)).not.toContain("api_key=secret");
  expect(JSON.stringify(applied)).not.toContain("api_key=secret");
  expect(service.store.getProvenance("manual", "manual:https://example.com/?api_key=%5Bredacted%5D")?.monitorId).toBeTruthy();
  service.close();
});

test("import preview detects updates to imported monitor settings", () => {
  const service = new UptimeService({ dbPath: tempDb() });
  service.applyImport({
    source: "manual",
    records: [{ sourceId: "api", monitor: { name: "api", kind: "http", url: "https://example.com", intervalSeconds: 60 } }],
  });

  const preview = service.previewImport({
    source: "manual",
    records: [{ sourceId: "api", monitor: { name: "api", kind: "http", url: "https://example.com", intervalSeconds: 30 } }],
  });
  const applied = service.applyImport({
    source: "manual",
    records: [{ sourceId: "api", monitor: { name: "api", kind: "http", url: "https://example.com", intervalSeconds: 30 } }],
  });

  expect(preview.totals.update).toBe(1);
  expect(applied.totals.update).toBe(1);
  expect(service.getMonitor("api")?.intervalSeconds).toBe(30);
  service.close();
});

test("import preview blocks malformed URLs without aborting dry-run", () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const preview = service.previewImport({
    source: "manual",
    records: [{ sourceId: "bad", monitor: { name: "bad", kind: "http", url: "https://[bad" } }],
  });

  expect(preview.totals.blocked).toBe(1);
  expect(preview.items[0].reason).toBeTruthy();
  expect(service.summary().totals.monitors).toBe(0);
  service.close();
});

test("import preview blocks apply-invalid fields before writes", () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const request = {
    source: "manual" as const,
    records: [
      { sourceId: "bad-name", monitor: { name: "bad\nname", kind: "http", url: "https://example.com" } },
      { sourceId: "bad-method", monitor: { name: "bad method", kind: "http", url: "https://example.com", method: "GET /" } },
      { sourceId: "bad-status", monitor: { name: "bad status", kind: "http", url: "https://example.com", expectedStatus: 999 } },
      { sourceId: "bad-interval", monitor: { name: "bad interval", kind: "http", url: "https://example.com", intervalSeconds: 0 } },
      { sourceId: "bad-timeout", monitor: { name: "bad timeout", kind: "http", url: "https://example.com", timeoutMs: 0 } },
      { sourceId: "bad-retry", monitor: { name: "bad retry", kind: "http", url: "https://example.com", retryCount: 11 } },
      { sourceId: "bad-host", monitor: { name: "bad host", kind: "tcp", host: "db\nexample", port: 5432 } },
    ],
  };

  const preview = service.previewImport(request);
  const applied = service.applyImport(request);

  expect(preview.totals.blocked).toBe(7);
  expect(applied.totals.blocked).toBe(7);
  expect(service.summary().totals.monitors).toBe(0);
  service.close();
});

test("import idempotency normalizes methods and preserves omitted expected status", () => {
  const service = new UptimeService({ dbPath: tempDb() });
  service.applyImport({
    source: "manual",
    records: [{ sourceId: "api", monitor: { name: "api", kind: "http", url: "https://example.com", method: "get", expectedStatus: 204 } }],
  });

  const lowercaseMethod = service.previewImport({
    source: "manual",
    records: [{ sourceId: "api", monitor: { name: "api", kind: "http", url: "https://example.com", method: "get", expectedStatus: 204 } }],
  });
  const omittedStatus = service.previewImport({
    source: "manual",
    records: [{ sourceId: "api", monitor: { name: "api", kind: "http", url: "https://example.com", method: "GET" } }],
  });

  expect(lowercaseMethod.totals.unchanged).toBe(1);
  expect(omittedStatus.totals.unchanged).toBe(1);
  service.close();
});

test("import updates can clear an expected status with explicit null", () => {
  const service = new UptimeService({ dbPath: tempDb() });
  service.applyImport({
    source: "manual",
    records: [{ sourceId: "api", monitor: { name: "api", kind: "http", url: "https://example.com", expectedStatus: 204 } }],
  });

  const preview = service.previewImport({
    source: "manual",
    records: [{ sourceId: "api", monitor: { name: "api", kind: "http", url: "https://example.com", expectedStatus: null } }],
  });
  const applied = service.applyImport({
    source: "manual",
    records: [{ sourceId: "api", monitor: { name: "api", kind: "http", url: "https://example.com", expectedStatus: null } }],
  });

  expect(preview.totals.update).toBe(1);
  expect(applied.totals.update).toBe(1);
  expect(service.getMonitor("api")?.expectedStatus).toBeNull();
  service.close();
});

test("import preview reports rename conflicts before apply", () => {
  const service = new UptimeService({ dbPath: tempDb() });
  service.createMonitor({ name: "taken", kind: "http", url: "https://taken.example" });
  service.applyImport({
    source: "manual",
    records: [{ sourceId: "api", monitor: { name: "api", kind: "http", url: "https://example.com" } }],
  });

  const preview = service.previewImport({
    source: "manual",
    records: [{ sourceId: "api", monitor: { name: "taken", kind: "http", url: "https://example.com" } }],
  });

  expect(preview.totals.conflict).toBe(1);
  expect(preview.items[0].reason).toContain("another monitor");
  service.close();
});

test("import preview dedupes intra-batch duplicates before writes", () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const request = {
    source: "manual" as const,
    records: [
      { sourceId: "api", monitor: { name: "api", kind: "http", url: "https://example.com/a" } },
      { sourceId: "api", monitor: { name: "api duplicate", kind: "http", url: "https://example.com/b" } },
      { sourceId: "api-2", monitor: { name: "api", kind: "http", url: "https://example.com/c" } },
    ],
  };

  const preview = service.previewImport(request);
  expect(preview.totals).toMatchObject({ create: 1, conflict: 2 });
  const applied = service.applyImport(request);
  expect(applied.totals).toMatchObject({ create: 1, conflict: 2 });
  expect(service.summary().totals.monitors).toBe(1);
  service.close();
});

test("import preview snapshots redact embedded local paths and secret-like values", () => {
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  const preview = service.previewImport({
    source: "manual",
    records: [{
      sourceId: "api",
      monitor: { name: "api", kind: "http", url: "https://example.com" },
      message: "error at /Users/example/private/file token=abc",
    }],
  });
  const snapshot = JSON.stringify(preview.items[0].candidate.snapshot);

  expect(snapshot).toContain("[local-path]");
  expect(snapshot).toContain("token=[redacted]");
  expect(snapshot).not.toContain("/Users/example/private");
  expect(snapshot).not.toContain("token=abc");
  service.close();
});

test("import preview and apply do not leak secret-bearing target fragments", () => {
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  const rawSourceId = "https://example.com/callback#access_token=secret";
  const preview = service.previewImport({
    source: "manual",
    records: [{
      sourceId: rawSourceId,
      monitor: { name: "callback", kind: "browser_page", url: "https://example.com/callback#access_token=secret" },
    }],
  });

  expect(preview.totals.blocked).toBe(1);
  expect(preview.items[0].reason).toContain("fragment contains secret-like data");
  expect(preview.items[0].candidate.sourceId).toBe("https://example.com/callback");
  expect(JSON.stringify(preview)).not.toContain("access_token=secret");
  service.close();

  const local = new UptimeService({ dbPath: tempDb() });
  local.applyImport({
    source: "manual",
    records: [{
      sourceId: rawSourceId,
      monitor: { name: "callback", kind: "browser_page", url: "https://example.com/callback#access_token=secret" },
    }],
  });
  expect(local.getMonitor("callback")?.url).toBe("https://example.com/callback");
  expect(local.store.getProvenance("manual", "https://example.com/callback")?.monitorId).toBeTruthy();
  expect(JSON.stringify(local.store.getProvenance("manual", "https://example.com/callback"))).not.toContain("access_token=secret");
  local.close();
});

test("browser imports do not echo raw host metadata", () => {
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  const preview = service.previewImport({
    source: "manual",
    records: [{
      sourceId: "page",
      monitor: {
        name: "page",
        kind: "browser_page",
        url: "https://example.com",
        host: "/Users/example/private token=secret",
      },
    }],
  });

  expect(preview.totals.create).toBe(1);
  expect(preview.items[0].candidate.host).toBeUndefined();
  expect(JSON.stringify(preview)).not.toContain("/Users/example/private");
  expect(JSON.stringify(preview)).not.toContain("token=secret");
  service.close();
});

test("browser imports do not use hostname as a name fallback", () => {
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  const preview = service.previewImport({
    source: "manual",
    records: [{
      sourceId: "page",
      kind: "browser_page",
      url: "https://example.com/app",
      hostname: "internal.admin.local",
    }],
  });

  expect(preview.totals.create).toBe(1);
  expect(preview.items[0].candidate.name).toBe("manual-https://example.com/app");
  expect(preview.items[0].candidate.host).toBeUndefined();
  expect(JSON.stringify(preview)).not.toContain("internal.admin.local");
  expect(JSON.stringify(preview)).toContain("[private-host]");
  service.close();
});

test("import preview blocks unsafe hosted targets before apply", () => {
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  const preview = service.previewImport({
    source: "manual",
    records: [{ sourceId: "metadata", monitor: { name: "metadata", kind: "http", url: "http://169.254.169.254/latest/meta-data" } }],
  });

  expect(preview.totals).toMatchObject({ blocked: 1 });
  expect(preview.items[0].reason).toContain("private or reserved IPv4");
  const secretPreview = service.previewImport({
    source: "manual",
    records: [{
      sourceId: "https://example.com/?api_key=secret#access_token=secret",
      monitor: { name: "secret", kind: "http", url: "https://example.com/?api_key=secret" },
    }],
  });
  expect(secretPreview.totals).toMatchObject({ blocked: 1 });
  expect(secretPreview.items[0].candidate.sourceId).toBe("https://example.com/?api_key=%5Bredacted%5D");
  expect(secretPreview.items[0].candidate.url).toBe("https://example.com/?api_key=%5Bredacted%5D");
  expect(JSON.stringify(secretPreview)).not.toContain("api_key=secret");
  expect(JSON.stringify(secretPreview)).not.toContain("access_token=secret");
  expect(() => service.applyImport({
    source: "manual",
    records: [{ sourceId: "api", monitor: { name: "api", kind: "http", url: "https://example.com" } }],
  })).toThrow("hosted import apply requires cloud import_batches and audit");
  service.close();
});

test("scheduled reports record runs, advance due time, and audit actions", async () => {
  const calls: string[] = [];
  const service = new UptimeService({ dbPath: tempDb() });
  service.createMonitor({ name: "api", kind: "http", url: "https://example.com" });
  const schedule = service.createReportSchedule({
    name: "ops",
    intervalSeconds: 60,
    nextRunAt: "2026-01-01T00:00:00.000Z",
    channels: {
      logs: { apiUrl: "http://logs.test", projectId: "uptime" },
    },
  });

  const runs = await service.runDueReportSchedules(new Date("2026-01-01T00:00:00.000Z"), {
    fetchImpl: (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ id: "log_1" }), { status: 201 });
    }) as typeof fetch,
  });
  const updated = service.getReportSchedule(schedule.id)!;
  const audit = service.listAuditEvents({ resourceType: "report_schedule", resourceId: schedule.id, limit: 10 });

  expect(runs).toHaveLength(1);
  expect(runs[0]).toMatchObject({ scheduleId: schedule.id, status: "success" });
  expect(runs[0].deliveries[0]).toMatchObject({ channel: "logs", ok: true });
  expect(updated.lastRunAt).toBe(runs[0].finishedAt);
  expect(updated.nextRunAt > runs[0].finishedAt).toBe(true);
  expect(service.listReportRuns({ scheduleId: schedule.id })).toHaveLength(1);
  expect(audit.map((event) => event.action)).toContain("report_schedule.run");
  expect(audit.map((event) => event.action)).toContain("report_schedule.create");
  expect(calls).toEqual(["http://logs.test/api/logs/structured?format=json&source=structured&service=open-uptime&project_id=uptime&environment=test"]);
  service.close();
});

test("local scheduler runs due report schedules when enabled", async () => {
  const calls: string[] = [];
  const service = new UptimeService({
    dbPath: tempDb(),
    checkRunner: async () => ({ status: "up", latencyMs: 1, statusCode: 200, error: null }),
  });
  service.createMonitor({ name: "api", kind: "http", url: "https://example.com" });
  service.createReportSchedule({
    name: "ops",
    intervalSeconds: 60,
    nextRunAt: new Date(Date.now() - 1000).toISOString(),
    channels: {
      logs: { apiUrl: "http://logs.test", projectId: "uptime" },
    },
  });

  const scheduler = service.startScheduler({
    tickMs: 10,
    reportFetchImpl: (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ id: "log_1" }), { status: 201 });
    }) as typeof fetch,
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  scheduler.stop();

  expect(service.listReportRuns()).toHaveLength(1);
  expect(calls).toEqual(["http://logs.test/api/logs/structured?format=json&source=structured&service=open-uptime&project_id=uptime&environment=test"]);
  service.close();
});

test("scheduled reports reject persisted API keys and redact audit metadata", () => {
  const service = new UptimeService({ dbPath: tempDb() });

  expect(() => service.createReportSchedule({
    name: "secret",
    intervalSeconds: 60,
    channels: {
      email: { to: "ops@example.com", sendKey: "esk_secret" } as never,
    },
  })).toThrow("must not persist API keys");
  expect(() => service.createReportSchedule({
    name: "secret-url-userinfo",
    intervalSeconds: 60,
    channels: {
      logs: { apiUrl: "http://user:pass@logs.test", projectId: "uptime" },
    },
  })).toThrow("must not include credentials");
  expect(() => service.createReportSchedule({
    name: "secret-url-query",
    intervalSeconds: 60,
    channels: {
      logs: { apiUrl: "http://logs.test?api_key=secret", projectId: "uptime" },
    },
  })).toThrow("must not include secret query");

  const event = service.recordAuditEvent({
    action: "test.secret",
    metadata: {
      sendKey: "esk_secret",
      nested: { apiToken: "tok_secret", ok: true },
      url: "http://user:pass@logs.test/path?api_key=secret#secret",
      auth: "Bearer abc123",
    },
  });
  const run = (service.store as UptimeStore).recordReportRun({
    status: "failed",
    error: "Bearer abc123 failed at http://logs.test/path?api_key=secret",
    deliveries: [{ channel: "logs", ok: false, error: "bad token abc123", id: "abc123" }],
  });

  expect(JSON.stringify(event.metadata)).not.toContain("esk_secret");
  expect(JSON.stringify(event.metadata)).not.toContain("tok_secret");
  expect(JSON.stringify(event.metadata)).not.toContain("user:pass");
  expect(JSON.stringify(event.metadata)).not.toContain("api_key=secret");
  expect(run.error).not.toContain("abc123");
  expect(run.error).not.toContain("api_key=secret");
  expect(event.metadata.sendKey).toBe("[REDACTED]");
  service.close();
});

test("hosted service rejects local report schedules until cloud channel refs exist", async () => {
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });

  expect(() => service.createReportSchedule({
    name: "hosted",
    intervalSeconds: 60,
    channels: { logs: true },
  })).toThrow("hosted report schedules require cloud channel refs");
  expect(() => service.listReportSchedules()).toThrow("hosted report schedules require cloud channel refs");
  await expect(service.runDueReportSchedules()).rejects.toThrow("hosted report schedules require cloud channel refs");
  service.close();
});

test("local backup verify and restore round trip preserves data", async () => {
  const dbPath = tempDb();
  const backupPath = join(mkdtempSync(join(tmpdir(), "open-uptime-backup-")), "backup.db");
  const restorePath = join(mkdtempSync(join(tmpdir(), "open-uptime-restore-")), "restored.db");
  cleanup.push(backupPath.replace(/\/backup\.db$/, ""));
  cleanup.push(restorePath.replace(/\/restored\.db$/, ""));
  const first = new UptimeService({
    dbPath,
    checkRunner: async () => ({ status: "down", latencyMs: 5, statusCode: 500, error: "boom" }),
  });
  first.createMonitor({ name: "backup", kind: "http", url: "https://example.com" });
  await first.checkMonitor("backup");
  const backup = first.backup(backupPath);
  const check = first.verifyBackup(backup.backupPath);
  first.close();

  expect(backup.bytes).toBeGreaterThan(0);
  expect(check).toMatchObject({ ok: true, integrity: "ok", schemaVersion: "4", monitors: 1, results: 1, incidents: 1 });

  UptimeStore.restoreBackup(backup.backupPath, restorePath);
  const restored = new UptimeService({ dbPath: restorePath });
  expect(restored.listMonitors({ includeDisabled: true })).toHaveLength(1);
  expect(restored.listResults()).toHaveLength(1);
  expect(restored.listIncidents({ status: "open" })).toHaveLength(1);
  restored.close();
});

test("schema v1 backups missing only probe tables remain restorable", () => {
  const legacyPath = tempDb();
  const restorePath = join(mkdtempSync(join(tmpdir(), "open-uptime-v1-restore-")), "restored.db");
  cleanup.push(restorePath.replace(/\/restored\.db$/, ""));
  const source = new UptimeService({ dbPath: legacyPath });
  source.createMonitor({ name: "legacy", kind: "http", url: "https://example.com" });
  source.close();

  const db = new Database(legacyPath);
  db.run("PRAGMA foreign_keys = OFF");
  db.run("DROP TABLE probe_submissions");
  db.run("DROP TABLE probe_check_jobs");
  db.run("DROP TABLE probe_identities");
  db.query("UPDATE schema_migrations SET value = '1' WHERE key = 'schema_version'").run();
  db.run("PRAGMA foreign_keys = ON");
  db.close();

  const check = UptimeStore.verifyBackup(legacyPath);
  expect(check).toMatchObject({ ok: true, integrity: "ok", schemaVersion: "1", monitors: 1 });
  expect(check.missingTables.sort()).toEqual(["probe_check_jobs", "probe_identities", "probe_submissions"].sort());

  UptimeStore.restoreBackup(legacyPath, restorePath);
  const restored = new UptimeService({ dbPath: restorePath });
  expect(restored.listMonitors({ includeDisabled: true })).toHaveLength(1);
  expect(restored.createProbe({ name: "post-restore" }).publicKeyFingerprint).toHaveLength(64);
  expect(restored.verifyBackup(restorePath).schemaVersion).toBe("4");
  restored.close();
});

test("schema v2 backups missing only report and audit tables remain restorable", () => {
  const legacyPath = tempDb();
  const restorePath = join(mkdtempSync(join(tmpdir(), "open-uptime-v2-restore-")), "restored.db");
  cleanup.push(restorePath.replace(/\/restored\.db$/, ""));
  const source = new UptimeService({ dbPath: legacyPath });
  source.createMonitor({ name: "legacy-v2", kind: "http", url: "https://example.com" });
  source.close();

  const db = new Database(legacyPath);
  db.run("PRAGMA foreign_keys = OFF");
  db.run("DROP TABLE audit_events");
  db.run("DROP TABLE report_runs");
  db.run("DROP TABLE report_schedules");
  db.query("UPDATE schema_migrations SET value = '2' WHERE key = 'schema_version'").run();
  db.run("PRAGMA foreign_keys = ON");
  db.close();

  const check = UptimeStore.verifyBackup(legacyPath);
  expect(check).toMatchObject({ ok: true, integrity: "ok", schemaVersion: "2", monitors: 1 });
  expect(check.missingTables.sort()).toEqual(["audit_events", "report_runs", "report_schedules"].sort());

  UptimeStore.restoreBackup(legacyPath, restorePath);
  const restored = new UptimeService({ dbPath: restorePath });
  expect(restored.listReportSchedules()).toHaveLength(0);
  expect(restored.verifyBackup(restorePath).schemaVersion).toBe("4");
  restored.close();
});

test("backup verification rejects empty or wrong-schema SQLite databases", () => {
  const wrongPath = tempDb();
  const db = new Database(wrongPath, { create: true });
  db.run("CREATE TABLE other (id TEXT PRIMARY KEY)");
  db.close();

  const check = UptimeStore.verifyBackup(wrongPath);

  expect(check.ok).toBe(false);
  expect(check.integrity).toBe("ok");
  expect(check.missingTables).toContain("monitors");
  expect(() => UptimeStore.restoreBackup(wrongPath, tempDb())).toThrow("backup integrity check failed");
});

test("restore refuses existing destinations and SQLite sidecars", async () => {
  const source = new UptimeService({ dbPath: tempDb() });
  source.createMonitor({ name: "restore", kind: "http", url: "https://example.com" });
  const backup = source.backup(join(mkdtempSync(join(tmpdir(), "open-uptime-restore-backup-")), "backup.db"));
  cleanup.push(backup.backupPath.replace(/\/backup\.db$/, ""));
  source.close();

  const destination = tempDb();
  const existing = new UptimeService({ dbPath: destination });
  existing.close();

  expect(() => UptimeStore.restoreBackup(backup.backupPath, destination)).toThrow("restore destination already exists");
});
