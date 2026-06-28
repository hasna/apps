import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiHandler, serveUptime } from "../src/api.js";
import { UptimeService } from "../src/service.js";

const cleanup: string[] = [];

afterEach(() => {
  while (cleanup.length > 0) rmSync(cleanup.pop()!, { recursive: true, force: true });
});

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "open-uptime-api-"));
  cleanup.push(dir);
  return join(dir, "uptime.db");
}

function jsonRequest(url: string, method: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("API creates monitors and returns summary", async () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const handler = createApiHandler(service);

  const create = await handler(jsonRequest("http://127.0.0.1/api/monitors", "POST", { name: "api", kind: "http", url: "https://example.com" }));
  const created = await create.json();
  const summary = await handler(new Request("http://127.0.0.1/api/summary"));
  const body = await summary.json();

  expect(create.status).toBe(201);
  expect(created.name).toBe("api");
  expect(body.totals.monitors).toBe(1);
  service.close();
});

test("API rejects cross-origin state-changing requests", async () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const handler = createApiHandler(service);

  const response = await handler(jsonRequest(
    "http://127.0.0.1:3899/api/monitors",
    "POST",
    { name: "csrf", kind: "http", url: "https://example.com" },
    { origin: "https://evil.example" },
  ));
  const summary = service.summary();

  expect(response.status).toBe(403);
  expect((await response.json()).error).toContain("cross-origin");
  expect(summary.totals.monitors).toBe(0);
  service.close();
});

test("API rejects non-loopback mutation hosts without a token", async () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const handler = createApiHandler(service);

  const response = await handler(jsonRequest(
    "http://attacker.test:3899/api/monitors",
    "POST",
    { name: "dns-rebind", kind: "http", url: "https://example.com" },
    { origin: "http://attacker.test:3899" },
  ));

  expect(response.status).toBe(403);
  expect((await response.json()).error).toContain("non-loopback host rejected");
  expect(service.summary().totals.monitors).toBe(0);
  service.close();
});

test("API allows non-loopback mutation hosts with an API token", async () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const handler = createApiHandler(service, { apiToken: "secret" });

  const response = await handler(jsonRequest(
    "http://internal.example:3899/api/monitors",
    "POST",
    { name: "token", kind: "http", url: "https://example.com" },
    { origin: "http://internal.example:3899", authorization: "Bearer secret" },
  ));

  expect(response.status).toBe(201);
  expect(service.summary().totals.monitors).toBe(1);
  service.close();
});

test("hosted API uses scoped /api/v1 auth and leaves legacy routes local-only", async () => {
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  const handler = createApiHandler(service, {
    mode: "hosted",
    hostedTokens: [
      { token: "read", scopes: ["uptime:read"], workspaceId: "ws_a" },
      { token: "write", scopes: ["uptime:write"], workspaceId: "ws_a" },
    ],
  });

  const health = await handler(new Request("https://uptime.test/health"));
  const dashboard = await handler(new Request("https://uptime.test/"));
  const authedDashboard = await handler(new Request("https://uptime.test/", {
    headers: { authorization: "Bearer read" },
  }));
  const summary = await handler(new Request("https://uptime.test/api/v1/summary"));
  const legacySummary = await handler(new Request("https://uptime.test/api/summary", {
    headers: { authorization: "Bearer read" },
  }));
  const authedSummary = await handler(new Request("https://uptime.test/api/v1/summary", {
    headers: { authorization: "Bearer read" },
  }));
  const readCreate = await handler(jsonRequest(
    "https://uptime.test/api/v1/monitors",
    "POST",
    { name: "read-only", kind: "http", url: "https://example.com" },
    { origin: "https://uptime.test", authorization: "Bearer read" },
  ));
  const create = await handler(jsonRequest(
    "https://uptime.test/api/v1/monitors",
    "POST",
    { name: "hosted", kind: "http", url: "https://example.com" },
    { origin: "https://uptime.test", authorization: "Bearer write" },
  ));
  const workspaceMismatch = await handler(new Request("https://uptime.test/api/v1/summary", {
    headers: { authorization: "Bearer read", "x-uptime-workspace": "ws_b" },
  }));

  expect(health.status).toBe(200);
  expect(await health.json()).toMatchObject({ ok: true, mode: "hosted", dataMode: "hosted-local-sqlite" });
  expect(dashboard.status).toBe(401);
  expect(authedDashboard.status).toBe(501);
  expect(summary.status).toBe(401);
  expect(legacySummary.status).toBe(404);
  expect(authedSummary.status).toBe(200);
  expect(readCreate.status).toBe(403);
  expect(create.status).toBe(201);
  expect(workspaceMismatch.status).toBe(403);
  expect(service.summary().totals.monitors).toBe(1);
  service.close();
});

test("hosted API fails closed when auth token is not configured", async () => {
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  const handler = createApiHandler(service, { mode: "hosted" });

  const health = await handler(new Request("https://uptime.test/health"));
  const summary = await handler(new Request("https://uptime.test/api/v1/summary"));

  expect(health.status).toBe(200);
  expect(summary.status).toBe(503);
  expect((await summary.json()).error).toContain("hosted auth token is not configured");
  service.close();
});

test("hosted API still rejects cross-origin mutations with a valid token", async () => {
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  const handler = createApiHandler(service, { mode: "hosted", hostedToken: "secret" });

  const response = await handler(jsonRequest(
    "https://uptime.test/api/v1/monitors",
    "POST",
    { name: "hosted-csrf", kind: "http", url: "https://example.com" },
    { origin: "https://evil.test", authorization: "Bearer secret" },
  ));

  expect(response.status).toBe(403);
  expect((await response.json()).error).toContain("cross-origin");
  expect(service.summary().totals.monitors).toBe(0);
  service.close();
});

test("hosted API blocks raw report delivery and inline checks", async () => {
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  service.createMonitor({ name: "api", kind: "http", url: "https://example.com" });
  const handler = createApiHandler(service, {
    mode: "hosted",
    hostedTokens: [
      { token: "report", scopes: ["uptime:report"] },
      { token: "probe", scopes: ["uptime:probe"] },
    ],
  });

  const report = await handler(jsonRequest(
    "https://uptime.test/api/v1/report",
    "POST",
    { logs: { apiUrl: "https://logs.example", projectId: "open-uptime" } },
    { origin: "https://uptime.test", authorization: "Bearer report" },
  ));
  const checkAll = await handler(new Request("https://uptime.test/api/v1/check-all", {
    method: "POST",
    headers: { origin: "https://uptime.test", authorization: "Bearer probe" },
  }));

  expect(report.status).toBe(501);
  expect((await report.json()).error).toContain("channel refs");
  expect(checkAll.status).toBe(501);
  expect((await checkAll.json()).error).toContain("check_jobs");
  service.close();
});

test("hosted API enforces target policy at monitor creation", async () => {
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  const handler = createApiHandler(service, { mode: "hosted", hostedToken: "secret" });
  const cases = [
    { name: "loopback", kind: "http", url: "http://127.0.0.1:3000" },
    { name: "metadata", kind: "http", url: "http://169.254.169.254/latest/meta-data" },
    { name: "userinfo", kind: "http", url: "https://user:pass@example.com" },
    { name: "secret-query", kind: "http", url: "https://example.com/?api_key=secret" },
    { name: "private-tcp", kind: "tcp", host: "10.0.0.1", port: 5432 },
  ];

  for (const input of cases) {
    const response = await handler(jsonRequest(
      "https://uptime.test/api/v1/monitors",
      "POST",
      input,
      { origin: "https://uptime.test", authorization: "Bearer secret" },
    ));
    expect(response.status).toBe(400);
  }
  expect(service.summary().totals.monitors).toBe(0);
  service.close();
});

test("hosted handler rejects a local-mode service", () => {
  const service = new UptimeService({ dbPath: tempDb() });
  expect(() => createApiHandler(service, { mode: "hosted", hostedToken: "secret" }))
    .toThrow("API mode hosted does not match store mode local");
  service.close();
});

test("serve hosted mode requires an auth token before startup", () => {
  expect(() => serveUptime({
    mode: "hosted",
    allowHostedLocalStore: true,
    dbPath: tempDb(),
  })).toThrow("hosted mode requires HASNA_UPTIME_HOSTED_TOKEN or --hosted-token");
});

test("serve hosted mode rejects inline scheduler", () => {
  expect(() => serveUptime({
    mode: "hosted",
    allowHostedLocalStore: true,
    hostedToken: "secret",
    check: true,
    dbPath: tempDb(),
  })).toThrow("hosted scheduler requires check_jobs and probes");
});

test("serve default stays local when hosted env vars are set", () => {
  const previousMode = process.env.HASNA_UPTIME_MODE;
  const previousToken = process.env.HASNA_UPTIME_HOSTED_TOKEN;
  process.env.HASNA_UPTIME_MODE = "hosted";
  delete process.env.HASNA_UPTIME_HOSTED_TOKEN;
  let runtime: ReturnType<typeof serveUptime> | undefined;
  try {
    runtime = serveUptime({ dbPath: tempDb(), port: 0 });
    expect(runtime.service.store.mode).toBe("local");
    expect(runtime.service.store.dataMode).toBe("local-sqlite");
  } finally {
    runtime?.server.stop(true);
    runtime?.service.close();
    if (previousMode === undefined) delete process.env.HASNA_UPTIME_MODE;
    else process.env.HASNA_UPTIME_MODE = previousMode;
    if (previousToken === undefined) delete process.env.HASNA_UPTIME_HOSTED_TOKEN;
    else process.env.HASNA_UPTIME_HOSTED_TOKEN = previousToken;
  }
});

test("API rejects tokenless mutations when served on a non-loopback bind even with loopback Host", async () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const handler = createApiHandler(service, { trustedLoopback: false });

  const response = await handler(jsonRequest(
    "http://127.0.0.1:3899/api/monitors",
    "POST",
    { name: "forged-host", kind: "http", url: "https://example.com" },
  ));

  expect(response.status).toBe(403);
  expect(service.summary().totals.monitors).toBe(0);
  service.close();
});

test("API rejects non-JSON bodies for JSON mutations", async () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const handler = createApiHandler(service);

  const response = await handler(new Request("http://127.0.0.1:3899/api/monitors", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify({ name: "plain", kind: "http", url: "https://example.com" }),
  }));

  expect(response.status).toBe(415);
  expect(service.summary().totals.monitors).toBe(0);
  service.close();
});

test("API rejects unbounded retry settings", async () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const handler = createApiHandler(service);

  const response = await handler(jsonRequest("http://127.0.0.1:3899/api/monitors", "POST", {
    name: "dos",
    kind: "http",
    url: "https://example.com",
    retryCount: 10_000,
  }));
  const body = await response.json();

  expect(response.status).toBe(400);
  expect(body.error).toContain("retryCount must be an integer from 0 to 10");
  expect(service.summary().totals.monitors).toBe(0);
  service.close();
});

test("API rejects invalid enabled types", async () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const handler = createApiHandler(service);

  const response = await handler(jsonRequest("http://127.0.0.1:3899/api/monitors", "POST", {
    name: "bad-enabled",
    kind: "http",
    url: "https://example.com",
    enabled: 0,
  }));
  const body = await response.json();

  expect(response.status).toBe(400);
  expect(body.error).toContain("enabled must be a boolean");
  expect(service.summary().totals.monitors).toBe(0);
  service.close();
});

test("API patches monitor configuration", async () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const handler = createApiHandler(service);
  const create = await handler(jsonRequest("http://127.0.0.1/api/monitors", "POST", { name: "api", kind: "http", url: "https://example.com" }));
  const monitor = await create.json();

  const patch = await handler(jsonRequest(`http://127.0.0.1/api/monitors/${monitor.id}`, "PATCH", { method: "head", expectedStatus: 204, intervalSeconds: 30 }));
  const updated = await patch.json();

  expect(patch.status).toBe(200);
  expect(updated.method).toBe("HEAD");
  expect(updated.expectedStatus).toBe(204);
  expect(updated.intervalSeconds).toBe(30);
  service.close();
});

test("API ignores raw status changes without a check result", async () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const handler = createApiHandler(service);
  const create = await handler(jsonRequest("http://127.0.0.1/api/monitors", "POST", { name: "api", kind: "http", url: "https://example.com" }));
  const monitor = await create.json();

  const patch = await handler(jsonRequest(`http://127.0.0.1/api/monitors/${monitor.id}`, "PATCH", { status: "down" }));
  const updated = await patch.json();
  const summary = await handler(new Request("http://127.0.0.1/api/summary"));
  const body = await summary.json();

  expect(patch.status).toBe(200);
  expect(updated.status).toBe("unknown");
  expect(body.totals.down).toBe(0);
  expect(body.totals.openIncidents).toBe(0);
  expect(body.monitors[0].totalChecks).toBe(0);
  service.close();
});

test("API target updates reset status and last check time", async () => {
  const service = new UptimeService({
    dbPath: tempDb(),
    checkRunner: async () => ({ status: "up", latencyMs: 1, statusCode: 200, error: null }),
  });
  const handler = createApiHandler(service);
  const create = await handler(jsonRequest("http://127.0.0.1/api/monitors", "POST", { name: "api", kind: "http", url: "https://old.example/health" }));
  const monitor = await create.json();
  await handler(new Request(`http://127.0.0.1/api/monitors/${monitor.id}/check`, { method: "POST" }));

  const patch = await handler(jsonRequest(`http://127.0.0.1/api/monitors/${monitor.id}`, "PATCH", { url: "https://new.example/health" }));
  const updated = await patch.json();

  expect(updated.status).toBe("unknown");
  expect(updated.lastCheckedAt).toBeNull();
  service.close();
});

test("API exposes check-all results, incidents, result history, and delete", async () => {
  let up = false;
  const service = new UptimeService({
    dbPath: tempDb(),
    checkRunner: async () => up
      ? { status: "up", latencyMs: 20, statusCode: 200, error: null }
      : { status: "down", latencyMs: 50, statusCode: 500, error: "down" },
  });
  const handler = createApiHandler(service);
  const create = await handler(jsonRequest("http://127.0.0.1/api/monitors", "POST", { name: "api", kind: "http", url: "https://example.com" }));
  const monitor = await create.json();

  const down = await handler(new Request("http://127.0.0.1/api/check-all", { method: "POST" }));
  up = true;
  const recovered = await handler(new Request(`http://127.0.0.1/api/monitors/${monitor.id}/check`, { method: "POST" }));
  const results = await handler(new Request("http://127.0.0.1/api/results?limit=5"));
  const incidents = await handler(new Request("http://127.0.0.1/api/incidents?limit=5"));
  const deleted = await handler(new Request(`http://127.0.0.1/api/monitors/${monitor.id}`, { method: "DELETE" }));

  expect((await down.json())[0].status).toBe("down");
  expect((await recovered.json()).status).toBe("up");
  expect(await results.json()).toHaveLength(2);
  expect((await incidents.json())[0].status).toBe("closed");
  expect((await deleted.json()).deleted).toBe(true);
  service.close();
});

test("API builds and sends reports with injected fetch", async () => {
  const calls: string[] = [];
  const service = new UptimeService({ dbPath: tempDb() });
  service.createMonitor({ name: "api", kind: "http", url: "https://example.com" });
  const handler = createApiHandler(service, {
    fetchImpl: (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ id: "ok" }), { status: 201 });
    }) as typeof fetch,
  });

  const report = await handler(new Request("http://127.0.0.1:3899/api/report"));
  const send = await handler(jsonRequest("http://127.0.0.1:3899/api/report", "POST", {
    logs: { apiUrl: "http://logs.test", projectId: "uptime" },
  }));

  expect(report.status).toBe(200);
  expect((await report.json()).json.kind).toBe("open-uptime.report");
  expect(send.status).toBe(200);
  expect((await send.json())[0].ok).toBe(true);
  expect(calls).toEqual(["http://logs.test/api/logs/structured?format=json&source=structured&service=open-uptime&project_id=uptime&environment=test"]);
  service.close();
});

test("dashboard route returns HTML", async () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const handler = createApiHandler(service);
  const response = await handler(new Request("http://127.0.0.1/"));
  const body = await response.text();

  expect(response.headers.get("content-type")).toContain("text/html");
  expect(body).toContain("Open Uptime");
  expect(body).toContain("monitor-form");
  expect(body).toContain("Recent Results");
  expect(body).toContain("textContent");
  expect(body).not.toContain("m.name +");
  service.close();
});
