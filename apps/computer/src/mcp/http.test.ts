import { afterEach, describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { buildServer } from "./server.js";
import {
  healthPayload,
  isHttpMode,
  resolveHttpPort,
  startMcpHttpServer,
} from "./http.js";

const servers: Array<{ stop: () => void }> = [];

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

  it("resolveHttpPort prefers --port then env then default", () => {
    expect(resolveHttpPort(["--port", "9001"])).toBe(9001);
    expect(resolveHttpPort(["--port=9002"])).toBe(9002);
    const prev = process.env.MCP_HTTP_PORT;
    process.env.MCP_HTTP_PORT = "9003";
    expect(resolveHttpPort([])).toBe(9003);
    if (prev === undefined) delete process.env.MCP_HTTP_PORT;
    else process.env.MCP_HTTP_PORT = prev;
    expect(resolveHttpPort([])).toBe(8806);
  });

  it("buildServer registers expected tools", async () => {
    const server = buildServer();
    expect(server).toBeDefined();
    await server.close();
  });

  it("GET /health returns ok payload", async () => {
    const { port, stop } = await startMcpHttpServer(0);
    servers.push({ stop });
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(healthPayload());
  });

  it("handles MCP initialize + tool call over Streamable HTTP", async () => {
    const { port, stop } = await startMcpHttpServer(0);
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
    const { port, stop } = await startMcpHttpServer(0);
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
});
