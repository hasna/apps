import { afterEach, describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { buildServer } from "./server.js";
import {
  healthPayload,
  isHttpMode,
  isStdioMode,
  resolveHttpPort,
  startMcpHttpServer,
} from "./http.js";

const servers: Array<{ stop: () => void }> = [];
const TEST_SECURITY = {
  allowUnauthenticated: true,
  allowedCorsOrigins: ["http://127.0.0.1:0"],
};

const MCP_INITIALIZE_BODY = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "computer-http-auth-test", version: "1.0.0" },
  },
};

function mcpPostHeaders(extra: Record<string, string> = {}): HeadersInit {
  return {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...extra,
  };
}

afterEach(() => {
  while (servers.length > 0) {
    servers.pop()?.stop();
  }
});

describe("computer MCP HTTP transport", () => {
  it("isHttpMode detects flag and env", () => {
    expect(isHttpMode([])).toBe(false);
    expect(isHttpMode(["--http"])).toBe(true);
    const prev = process.env.MCP_HTTP;
    process.env.MCP_HTTP = "1";
    expect(isHttpMode([])).toBe(true);
    if (prev === undefined) delete process.env.MCP_HTTP;
    else process.env.MCP_HTTP = prev;
  });

  it("stdio remains the default MCP mode", () => {
    expect(isHttpMode([])).toBe(false);
    expect(isStdioMode([])).toBe(false);
    expect(isStdioMode(["--stdio"])).toBe(true);
  });

  it("resolveHttpPort prefers --port then env then default", () => {
    expect(resolveHttpPort(["--port", "9001"])).toBe(9001);
    expect(resolveHttpPort(["--port=9002"])).toBe(9002);
    const prev = process.env.MCP_HTTP_PORT;
    process.env.MCP_HTTP_PORT = "9003";
    expect(resolveHttpPort([])).toBe(9003);
    if (prev === undefined) delete process.env.MCP_HTTP_PORT;
    else process.env.MCP_HTTP_PORT = prev;
    expect(resolveHttpPort([])).toBe(8883);
  });

  it("buildServer registers expected tools", async () => {
    const server = buildServer();
    expect(server).toBeDefined();
    await server.close();
  });

  it("GET /health returns ok payload", async () => {
    const { port, stop } = await startMcpHttpServer(0, TEST_SECURITY);
    servers.push({ stop });
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(healthPayload());
  });

  it("requires API-key auth for standalone MCP HTTP by default", async () => {
    const { port, stop } = await startMcpHttpServer(0, {
      apiKey: "secret",
      allowUnauthenticated: false,
      allowedCorsOrigins: ["http://127.0.0.1:19450"],
    });
    servers.push({ stop });
    const url = `http://127.0.0.1:${port}/mcp`;

    const unauthenticated = await fetch(url, {
      method: "POST",
      headers: mcpPostHeaders(),
      body: JSON.stringify(MCP_INITIALIZE_BODY),
    });
    expect(unauthenticated.status).toBe(401);

    const wrong = await fetch(url, {
      method: "POST",
      headers: mcpPostHeaders({ authorization: "Bearer wrong" }),
      body: JSON.stringify(MCP_INITIALIZE_BODY),
    });
    expect(wrong.status).toBe(401);

    const bearer = await fetch(url, {
      method: "POST",
      headers: mcpPostHeaders({ authorization: "Bearer secret" }),
      body: JSON.stringify(MCP_INITIALIZE_BODY),
    });
    expect(bearer.status).not.toBe(401);
    expect(bearer.status).not.toBe(403);

    const apiKey = await fetch(url, {
      method: "POST",
      headers: mcpPostHeaders({ "x-computer-api-key": "secret" }),
      body: JSON.stringify(MCP_INITIALIZE_BODY),
    });
    expect(apiKey.status).not.toBe(401);
    expect(apiKey.status).not.toBe(403);
  });

  it("rejects hostile browser origins in standalone MCP local-unauth mode", async () => {
    const allowedOrigin = "http://127.0.0.1:19450";
    const { port, stop } = await startMcpHttpServer(0, {
      allowUnauthenticated: true,
      allowedCorsOrigins: [allowedOrigin],
    });
    servers.push({ stop });
    const url = `http://127.0.0.1:${port}/mcp`;

    const hostile = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        origin: "https://evil.example",
      },
      body: JSON.stringify(MCP_INITIALIZE_BODY),
    });
    expect(hostile.status).toBe(403);
    expect(hostile.headers.get("Access-Control-Allow-Origin")).toBeNull();

    const preflight = await fetch(url, {
      method: "OPTIONS",
      headers: { origin: "https://evil.example" },
    });
    expect(preflight.status).toBe(403);

    const allowedPreflight = await fetch(url, {
      method: "OPTIONS",
      headers: { origin: allowedOrigin },
    });
    expect(allowedPreflight.status).toBe(200);
    expect(allowedPreflight.headers.get("Access-Control-Allow-Origin")).toBe(allowedOrigin);
  });

  it("handles MCP initialize + tool call over Streamable HTTP", async () => {
    const { port, stop } = await startMcpHttpServer(0, TEST_SECURITY);
    servers.push({ stop });

    const client = new Client(
      { name: "computer-http-test", version: "1.0.0" },
      { capabilities: {} }
    );
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`)
    );

    try {
      await client.connect(transport, { timeout: 10_000 });
      const tools = await client.listTools(undefined, { timeout: 10_000 });
      expect(tools.tools.some((t) => t.name === "computer_stats")).toBe(true);
      expect(tools.tools.some((t) => t.name === "computer_open_app")).toBe(true);
      expect(tools.tools.some((t) => t.name === "computer_list_apps")).toBe(true);
      expect(tools.tools.some((t) => t.name === "computer_pause_session")).toBe(true);
      expect(tools.tools.some((t) => t.name === "computer_resume_session")).toBe(true);

      const apps = await client.callTool(
        { name: "computer_list_apps", arguments: {} },
        undefined,
        { timeout: 10_000 }
      );
      const appsContent = apps.content as Array<{ type?: string; text?: string }>;
      expect(appsContent[0]?.type).toBe("text");
      const parsed = JSON.parse(appsContent[0]?.text ?? "[]") as Array<{ name: string; available: boolean }>;
      expect(parsed.some((a) => a.name === "ghostty")).toBe(true);

      const result = await client.callTool(
        { name: "computer_stats", arguments: {} },
        undefined,
        { timeout: 10_000 }
      );
      const content = result.content as Array<{ type?: string }>;
      expect(content[0]?.type).toBe("text");
    } finally {
      try {
        await client.close();
      } catch {
        // Stateless HTTP may already have closed the session.
      }
    }
  });

  it("serves three concurrent MCP clients from one process", async () => {
    const { port, stop } = await startMcpHttpServer(0, TEST_SECURITY);
    servers.push({ stop });

    async function callStats() {
      const client = new Client(
        { name: "computer-http-concurrent", version: "1.0.0" },
        { capabilities: {} }
      );
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${port}/mcp`)
      );
      await client.connect(transport, { timeout: 10_000 });
      const result = await client.callTool(
        { name: "computer_stats", arguments: {} },
        undefined,
        { timeout: 10_000 }
      );
      try {
        await client.close();
      } catch {
        // Stateless HTTP may already have closed the session.
      }
      return result;
    }

    const results = await Promise.all([callStats(), callStats(), callStats()]);
    expect(
      results.every((r) => (r.content as Array<{ type?: string }>)[0]?.type === "text")
    ).toBe(true);
  });

  it("blocks confirmation-required MCP actions before execution", async () => {
    const { port, stop } = await startMcpHttpServer(0, TEST_SECURITY);
    servers.push({ stop });

    const client = new Client(
      { name: "computer-http-policy-test", version: "1.0.0" },
      { capabilities: {} }
    );
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`)
    );

    try {
      await client.connect(transport, { timeout: 10_000 });
      const result = await client.callTool(
        { name: "computer_key", arguments: { keys: "cmd+shift+delete" } },
        undefined,
        { timeout: 10_000 }
      );
      const content = result.content as Array<{ type?: string; text?: string }>;
      expect(content[0]?.type).toBe("text");
      expect(content[0]?.text).toContain("requires confirmation");
    } finally {
      try {
        await client.close();
      } catch {
        // Stateless HTTP may already have closed the session.
      }
    }
  });
});
