import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { closeDatabase, resetDatabase } from "../db/database.ts";
import { buildServer } from "./index.ts";
import { handleMcpHttpRequest, healthResponse, isHttpMode, resolveHttpPort, startHttpServer } from "./http.ts";

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

describe("tickets MCP HTTP transport", () => {
  let port: number;
  let httpServer: ReturnType<typeof Bun.serve>;

  beforeAll(async () => {
    process.env["TICKETS_DB_PATH"] = ":memory:";
    resetDatabase();
    port = reserveFreePort(18841);
    httpServer = await startHttpServer(port);
  });

  afterAll(() => {
    httpServer.stop(true);
    closeDatabase();
    delete process.env["TICKETS_DB_PATH"];
  });

  it("resolveHttpPort prefers CLI flag, env, then default", () => {
    const originalArgv = [...process.argv];
    const originalEnv = process.env["MCP_HTTP_PORT"];
    try {
      process.argv = ["bun", "tickets-mcp", "--port", "9911"];
      expect(resolveHttpPort(8841)).toBe(9911);

      process.argv = ["bun", "tickets-mcp", "--port=9912"];
      expect(resolveHttpPort(8841)).toBe(9912);

      process.argv = ["bun", "tickets-mcp"];
      process.env["MCP_HTTP_PORT"] = "9913";
      expect(resolveHttpPort(8841)).toBe(9913);

      delete process.env["MCP_HTTP_PORT"];
      expect(resolveHttpPort(8841)).toBe(8841);
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
      process.argv = ["bun", "tickets-mcp"];
      delete process.env["MCP_HTTP"];
      expect(isHttpMode()).toBe(false);

      process.argv = ["bun", "tickets-mcp", "--http"];
      expect(isHttpMode()).toBe(true);

      process.argv = ["bun", "tickets-mcp"];
      process.env["MCP_HTTP"] = "1";
      expect(isHttpMode()).toBe(true);
    } finally {
      process.argv = originalArgv;
      if (originalEnv === undefined) delete process.env["MCP_HTTP"];
      else process.env["MCP_HTTP"] = originalEnv;
    }
  });

  it("healthResponse returns expected JSON", async () => {
    const res = healthResponse("tickets");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", name: "tickets" });
  });

  it("buildServer registers tools without starting transport", () => {
    const server = buildServer();
    expect(server).toBeDefined();
  });

  it("GET /health returns 200", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", name: "tickets" });
  });

  it("handles initialize + list_tools over Streamable HTTP", async () => {
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
          clientInfo: { name: "tickets-http-test", version: "1.0.0" },
        },
      }),
    });
    expect(initRes.status).toBe(200);
    const initBody = await initRes.json();
    expect(initBody.result.serverInfo.name).toBe("open-tickets");

    await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "mcp-protocol-version": initBody.result.protocolVersion,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });

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
    expect(toolsBody.result.tools.some((tool: { name: string }) => tool.name === "list_projects")).toBe(true);
  });

  it("serves multiple concurrent clients from one process", async () => {
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
            clientInfo: { name: `tickets-http-concurrent-${clientId}`, version: "1.0.0" },
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

  it("handleMcpHttpRequest works directly", async () => {
    const res = await handleMcpHttpRequest(
      new Request("http://127.0.0.1/mcp", {
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
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "direct-test", version: "1.0.0" },
          },
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.serverInfo.name).toBe("open-tickets");
  });
});