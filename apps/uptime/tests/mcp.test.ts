import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMcpServer } from "../src/mcp/index.js";
import { UptimeService } from "../src/service.js";

test("MCP server registers uptime tools and JSON resources", async () => {
  const dir = mkdtempSync(join(tmpdir(), "open-uptime-mcp-"));
  try {
    const service = new UptimeService({ dbPath: join(dir, "uptime.db") });
    service.createMonitor({ name: "api", kind: "http", url: "https://example.com" });
    const server = createMcpServer({ service }) as unknown as {
      _registeredResources: Record<string, { readCallback: (uri: URL) => Promise<{ contents: Array<{ text: string }> }> }>;
      _registeredTools: Record<string, { inputSchema?: { safeParse: (value: unknown) => { success: boolean } } }>;
    };

    expect(Object.keys(server._registeredTools)).toContain("uptime_summary");
    expect(Object.keys(server._registeredTools)).toContain("uptime_send_report");
    expect(Object.keys(server._registeredTools)).toContain("uptime_create_report_schedule");
    expect(Object.keys(server._registeredTools)).toContain("uptime_list_report_schedules");
    expect(Object.keys(server._registeredTools)).toContain("uptime_run_report_schedule");
    expect(Object.keys(server._registeredTools)).toContain("uptime_run_due_report_schedules");
    expect(Object.keys(server._registeredTools)).toContain("uptime_report_runs");
    expect(Object.keys(server._registeredTools)).toContain("uptime_audit_events");
    expect(Object.keys(server._registeredTools)).toContain("uptime_create_probe");
    expect(Object.keys(server._registeredTools)).toContain("uptime_list_probes");
    expect(Object.keys(server._registeredTools)).toContain("uptime_create_probe_job");
    expect(Object.keys(server._registeredTools)).toContain("uptime_claim_probe_job");
    expect(Object.keys(server._registeredTools)).toContain("uptime_submit_probe_result");
    expect(Object.keys(server._registeredTools)).toContain("uptime_import_preview");
    expect(Object.keys(server._registeredTools)).toContain("uptime_import_apply");
    expect(Object.keys(server._registeredTools)).toContain("uptime_import_rollback");
    expect(Object.keys(server._registeredResources).sort()).toEqual([
      "uptime://audit-events",
      "uptime://incidents",
      "uptime://monitors",
      "uptime://report-runs",
      "uptime://report-schedules",
      "uptime://summary",
    ]);

    const summary = await server._registeredResources["uptime://summary"].readCallback(new URL("uptime://summary"));
    expect(JSON.parse(summary.contents[0].text).totals.monitors).toBe(1);
    expect(server._registeredTools.uptime_create_monitor.inputSchema?.safeParse({
      name: "dos",
      kind: "http",
      url: "https://example.com",
      retryCount: 10_000,
    }).success).toBe(false);
    expect(server._registeredTools.uptime_send_report.inputSchema?.safeParse({
      logs: { apiUrl: "http://logs.test", projectId: "uptime" },
      timeoutMs: 1000,
    }).success).toBe(true);
    expect(server._registeredTools.uptime_create_report_schedule.inputSchema?.safeParse({
      name: "ops",
      intervalSeconds: 60,
      channels: { logs: { apiUrl: "http://logs.test", projectId: "uptime" } },
    }).success).toBe(true);
    expect(server._registeredTools.uptime_create_report_schedule.inputSchema?.safeParse({
      name: "ops",
      intervalSeconds: 60,
      channels: { logs: { apiUrl: "http://logs.test", apiKey: "secret" } },
    }).success).toBe(false);
    expect(server._registeredTools.uptime_import_preview.inputSchema?.safeParse({
      source: "manual",
      records: [{ sourceId: "api", monitor: { name: "api", kind: "http", url: "https://example.com" } }],
    }).success).toBe(true);
    expect(server._registeredTools.uptime_create_probe.inputSchema?.safeParse({
      name: "private-probe-01",
      publicKeyPem: "-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----",
    }).success).toBe(true);
    expect(server._registeredTools.uptime_create_probe.inputSchema?.safeParse({
      name: "private-probe-01",
    }).success).toBe(false);
    expect(server._registeredTools.uptime_submit_probe_result.inputSchema?.safeParse({
      probeId: "prb_1",
      jobId: "job_1",
      scheduleSlot: "slot-1",
      fencingToken: "fence_1",
      monitorId: "mon_1",
      nonce: "nonce-1",
      checkedAt: new Date().toISOString(),
      status: "up",
      latencyMs: 10,
      statusCode: 200,
      attemptCount: 1,
      monitorRevision: 1,
      evidence: null,
      signature: "sig",
    }).success).toBe(true);
    expect(server._registeredTools.uptime_submit_probe_result.inputSchema?.safeParse({
      probeId: "prb_1",
      monitorId: "mon_1",
      nonce: "nonce-1",
      checkedAt: new Date().toISOString(),
      status: "up",
      latencyMs: 10,
      monitorRevision: 1,
      signature: "sig",
    }).success).toBe(false);
    service.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("MCP default service stays local when hosted env vars are set", () => {
  const dir = mkdtempSync(join(tmpdir(), "open-uptime-mcp-"));
  const previousMode = process.env.HASNA_UPTIME_MODE;
  const previousToken = process.env.HASNA_UPTIME_HOSTED_TOKEN;
  const previousDb = process.env.HASNA_UPTIME_DB;
  process.env.HASNA_UPTIME_MODE = "hosted";
  process.env.HASNA_UPTIME_HOSTED_TOKEN = "hosted-secret";
  process.env.HASNA_UPTIME_DB = join(dir, "uptime.db");
  try {
    const server = createMcpServer() as unknown as {
      _registeredTools: Record<string, unknown>;
    };
    expect(Object.keys(server._registeredTools)).toContain("uptime_summary");
  } finally {
    if (previousMode === undefined) delete process.env.HASNA_UPTIME_MODE;
    else process.env.HASNA_UPTIME_MODE = previousMode;
    if (previousToken === undefined) delete process.env.HASNA_UPTIME_HOSTED_TOKEN;
    else process.env.HASNA_UPTIME_HOSTED_TOKEN = previousToken;
    if (previousDb === undefined) delete process.env.HASNA_UPTIME_DB;
    else process.env.HASNA_UPTIME_DB = previousDb;
    rmSync(dir, { recursive: true, force: true });
  }
});
