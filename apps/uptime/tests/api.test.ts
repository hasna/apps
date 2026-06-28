import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiHandler } from "../src/api.js";
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
