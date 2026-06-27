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
    expect(Object.keys(server._registeredResources).sort()).toEqual([
      "uptime://incidents",
      "uptime://monitors",
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
    service.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
