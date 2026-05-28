import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase } from "../db/database.js";
import { buildServer } from "./index.js";
import { healthResponse, isHttpMode, resolveHttpPort } from "./http.js";
import { startServer } from "../server/serve.js";

const SERVER_HOOK_TIMEOUT_MS = 15_000;

function reserveFreePort(start: number): number {
  for (let candidate = start; candidate < start + 100; candidate++) {
    try {
      const probe = Bun.serve({ port: candidate, hostname: "127.0.0.1", fetch: () => new Response("") });
      probe.stop(true);
      return candidate;
    } catch {
      // try next
    }
  }
  throw new Error(`No free port found near ${start}`);
}

describe("todos MCP HTTP transport", () => {
  let port: number;
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    port = reserveFreePort(18881);
    tmpDir = await mkdtemp(join(tmpdir(), "todos-mcp-http-test-"));
    dbPath = join(tmpDir, "test.db");
    process.env["TODOS_DB_PATH"] = dbPath;
    process.env["TODOS_AUTO_PROJECT"] = "false";
    process.env["TODOS_NO_OPEN"] = "true";
    await startServer(port, { open: false, host: "127.0.0.1" });
  }, SERVER_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    closeDatabase();
    delete process.env["TODOS_DB_PATH"];
    delete process.env["TODOS_AUTO_PROJECT"];
    delete process.env["TODOS_NO_OPEN"];
    await rm(tmpDir, { recursive: true, force: true });
  }, SERVER_HOOK_TIMEOUT_MS);

  it("resolveHttpPort prefers CLI flag, env, then default", () => {
    const originalArgv = [...process.argv];
    const originalEnv = process.env["MCP_HTTP_PORT"];
    try {
      process.argv = ["bun", "todos-mcp", "--port", "9921"];
      expect(resolveHttpPort(8881)).toBe(9921);
      process.argv = ["bun", "todos-mcp"];
      process.env["MCP_HTTP_PORT"] = "9922";
      expect(resolveHttpPort(8881)).toBe(9922);
    } finally {
      process.argv = originalArgv;
      if (originalEnv === undefined) delete process.env["MCP_HTTP_PORT"];
      else process.env["MCP_HTTP_PORT"] = originalEnv;
    }
  });

  it("isHttpMode detects flag and env", () => {
    const originalArgv = [...process.argv];
    const originalEnv = process.env["MCP_HTTP"];
    try {
      process.argv = ["bun", "todos-mcp"];
      delete process.env["MCP_HTTP"];
      expect(isHttpMode()).toBe(false);
      process.argv = ["bun", "todos-mcp", "--http"];
      expect(isHttpMode()).toBe(true);
      process.argv = ["bun", "todos-mcp"];
      process.env["MCP_HTTP"] = "1";
      expect(isHttpMode()).toBe(true);
    } finally {
      process.argv = originalArgv;
      if (originalEnv === undefined) delete process.env["MCP_HTTP"];
      else process.env["MCP_HTTP"] = originalEnv;
    }
  });

  it("healthResponse returns expected JSON", async () => {
    const res = healthResponse("todos");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", name: "todos" });
  });

  it("buildServer registers tools without starting transport", () => {
    const server = buildServer();
    expect(server).toBeDefined();
  });

  it("GET /health returns 200 from todos-serve", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", name: "todos" });
  });

  it("handles initialize + tools/list over Streamable HTTP on todos-serve", async () => {
    const initRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "todos-http-test", version: "1.0.0" },
        },
      }),
    });
    expect(initRes.status).toBe(200);
    const initBody = await initRes.json();
    expect(initBody.result.serverInfo.name).toBe("todos");

    const toolsRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "mcp-protocol-version": initBody.result.protocolVersion,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }),
    });
    expect(toolsRes.status).toBe(200);
    const toolsBody = await toolsRes.json();
    expect(toolsBody.result.tools.some((tool: { name: string }) => tool.name === "list_tasks")).toBe(true);
  });

  it("serves multiple concurrent MCP clients from one todos-serve process", async () => {
    async function listToolCount(clientId: number): Promise<number> {
      const initRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: clientId,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: `todos-http-concurrent-${clientId}`, version: "1.0.0" },
          },
        }),
      });
      const initBody = await initRes.json();
      const toolsRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "mcp-protocol-version": initBody.result.protocolVersion,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: clientId + 100,
          method: "tools/list",
          params: {},
        }),
      });
      const toolsBody = await toolsRes.json();
      return toolsBody.result.tools.length;
    }

    const counts = await Promise.all([listToolCount(1), listToolCount(2), listToolCount(3)]);
    expect(counts.every((count) => count > 0)).toBe(true);
  });
});
