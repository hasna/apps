import { describe, test, expect, afterAll } from "bun:test";
import type { Server } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import { startMcpHttpServer, resolveMcpHttpPort, DEFAULT_MCP_HTTP_PORT } from "./http.js";

const TEST_PORT = 18846;

// Stub factory: the real createServer() pulls in better-sqlite3 (node-only native
// addon, unsupported under the bun test runtime), so the HTTP transport wiring is
// verified here against a minimal in-memory server instead.
function buildStubServer(): McpServer {
  const server = new McpServer({ name: "terminal", version: "0.0.0" });
  server.registerTool(
    "ping",
    { title: "Ping", description: "Health check tool", inputSchema: { msg: z.string() } },
    async ({ msg }) => ({ content: [{ type: "text", text: `pong:${msg}` }] }),
  );
  return server;
}

describe("terminal MCP HTTP transport", () => {
  let httpServer: Server | undefined;

  afterAll(() => {
    httpServer?.close();
  });

  test("default port is 8846 and --port overrides", () => {
    expect(DEFAULT_MCP_HTTP_PORT).toBe(8846);
    expect(resolveMcpHttpPort([])).toBe(8846);
    expect(resolveMcpHttpPort(["--port", "9001"])).toBe(9001);
  });

  test("GET /health returns 200", async () => {
    httpServer = await startMcpHttpServer({
      name: "terminal",
      port: TEST_PORT,
      buildServer: buildStubServer,
    });
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", name: "terminal" });
  });

  test("MCP initialize + list/call tools over Streamable HTTP", async () => {
    const client = new Client({ name: "terminal-http-test", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${TEST_PORT}/mcp`),
    );
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.some((t) => t.name === "ping")).toBe(true);
    const result = await client.callTool({ name: "ping", arguments: { msg: "hi" } });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toBe("pong:hi");
    await client.close();
  });
});
