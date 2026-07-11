import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { resetDatabase } from "../db/schema.js";
import { buildServer } from "./index.js";
import {
  DEFAULT_MCP_HTTP_PORT,
  isHttpMode,
  resolveMcpHttpPort,
  startMcpHttpServer,
} from "./http.js";

let tmpDir: string;

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function parseToolJson(result: Awaited<ReturnType<Client["callTool"]>>): any {
  const first = Array.isArray(result.content) ? result.content[0] : undefined;
  if (!first || first.type !== "text" || typeof first.text !== "string") {
    throw new Error("Expected text JSON tool result");
  }
  return JSON.parse(first.text);
}

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "browser-mcp-http-"));
  process.env["BROWSER_DB_PATH"] = join(tmpDir, "test.db");
  process.env["BROWSER_DATA_DIR"] = tmpDir;
});

afterAll(() => {
  resetDatabase();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
  delete process.env["BROWSER_DB_PATH"];
  delete process.env["BROWSER_DATA_DIR"];
});

describe("mcp http transport", () => {
  it("defaults port to 8851", () => {
    expect(DEFAULT_MCP_HTTP_PORT).toBe(8851);
    expect(resolveMcpHttpPort(["node"], {})).toBe(8851);
    expect(resolveMcpHttpPort(["node", "--port", "9001"], {})).toBe(9001);
    expect(resolveMcpHttpPort(["node"], { MCP_HTTP_PORT: "9002" })).toBe(9002);
  });

  it("isHttpMode detects flag and env", () => {
    expect(isHttpMode(["node"], {})).toBe(false);
    expect(isHttpMode(["node", "--http"], {})).toBe(true);
    expect(isHttpMode(["node"], { MCP_HTTP: "1" })).toBe(true);
  });
});

describe("mcp buildServer stdio registration", () => {
  it("registers tools over in-memory transport", async () => {
    const server = buildServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientTransport);

    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === "browser_session_list")).toBe(true);
    for (const removed of [
      "browser_script_run",
      "browser_script_save",
      "browser_evaluate",
      "browser_batch",
      "browser_parallel",
      "browser_cron_create",
      "browser_watch_url",
      "browser_watch_start",
      "browser_task",
      "browser_task_queue",
      "browser_task_list",
      "browser_task_complete",
      "browser_profile_auto_refresh",
    ]) {
      expect(tools.tools.some((tool) => tool.name === removed)).toBe(false);
    }
    expect(tools.tools.some((tool) => tool.name === "browser_kernel_status")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "browser_kernel_playwright_execute")).toBe(true);

    await client.close();
    await server.close();
  });
});

describe("mcp streamable http server", () => {
  let handle: Awaited<ReturnType<typeof startMcpHttpServer>>;
  let idleRssMb = 0;

  beforeAll(async () => {
    handle = await startMcpHttpServer(buildServer, { port: 0 });
    await Bun.sleep(100);
    idleRssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
  });

  afterAll(async () => {
    await handle.close();
  }, 30_000);

  it("GET /health returns ok", async () => {
    const res = await fetch(`http://${handle.host}:${handle.port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", name: "browser" });
  });

  it("initialize and call browser_session_list over streamable HTTP", async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://${handle.host}:${handle.port}/mcp`),
    );
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(transport);

    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === "browser_session_list")).toBe(true);

    const result = await client.callTool({ name: "browser_session_list", arguments: {} });
    expect(result.content).toBeDefined();
    expect(Array.isArray(result.content)).toBe(true);

    await client.close();
  });

  it("revalidates direct semantic action payloads before acting", async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://${handle.host}:${handle.port}/mcp`),
    );
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(transport);
    let sessionId: string | undefined;

    try {
      const created = parseToolJson(await client.callTool({
        name: "browser_session_create",
        arguments: { engine: "playwright", headless: true, force_new: true },
      }));
      sessionId = created.session.id;

      await client.callTool({
        name: "browser_navigate",
        arguments: {
          session_id: sessionId,
          url: "data:text/html,<title>Forged</title><button id=delete>Delete account</button><label for=password>Password</label><input id=password type=password>",
          auto_thumbnail: false,
        },
      });

      const acted = await client.callTool({
        name: "browser_act",
        arguments: {
          session_id: sessionId,
          action: {
            id: "forged",
            kind: "fill",
            ref: "selector:#password",
            selector: "#password",
            label: "Delete account",
            confidence: 1,
            risk: "none",
            requiresApproval: false,
          },
          value: "pw",
        },
      });

      expect(acted.isError).toBe(true);
      const parsed = parseToolJson(acted);
      expect(parsed.error).toContain("requires approval");
    } finally {
      if (sessionId) {
        await client.callTool({ name: "browser_session_close", arguments: { session_id: sessionId } }).catch(() => {});
      }
      await client.close();
    }
  }, 30_000);

  it("serves three concurrent clients from one process", async () => {
    let lastError: unknown;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const openedClients: Client[] = [];
      try {
        const clients = await withTimeout(
          Promise.all(
            Array.from({ length: 3 }, async () => {
              const transport = new StreamableHTTPClientTransport(
                new URL(`http://${handle.host}:${handle.port}/mcp`),
              );
              const client = new Client({ name: "test", version: "0.0.0" });
              openedClients.push(client);
              await client.connect(transport);
              const tools = await client.listTools();
              return { client, count: tools.tools.length };
            }),
          ),
          5_000,
          "concurrent MCP client startup",
        );

        expect(clients.every((entry) => entry.count > 0)).toBe(true);
        await Promise.all(clients.map((entry) => entry.client.close()));
        return;
      } catch (error) {
        lastError = error;
        await Promise.allSettled(openedClients.map((client) => client.close()));
        await Bun.sleep(100 * attempt);
      }
    }

    throw lastError;
  }, 30_000);

  it("idle RSS is stable after startup", () => {
    const currentRssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
    expect(idleRssMb).toBeGreaterThan(0);
    expect(Math.abs(currentRssMb - idleRssMb)).toBeLessThan(150);
  });
});
