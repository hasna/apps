import { afterEach, describe, expect, it } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { DEFAULT_MCP_HTTP_PORT, isHttpMode, resolveMcpHttpPort, startMcpHttpServer } from "./http.js";

process.env.TESTERS_DB_PATH = ":memory:";

function createTestMcpServer(): McpServer {
  const server = new McpServer({ name: "testers", version: "0.0.0" });
  server.tool("list_scenarios", "List test scenarios", {}, async () => ({
    content: [{ type: "text" as const, text: JSON.stringify([], null, 2) }],
  }));
  server.tool("describe_tools", "List tools", {}, async () => ({
    content: [{ type: "text" as const, text: "list_scenarios" }],
  }));
  return server;
}

describe("testers-mcp HTTP transport", () => {
  let httpServer: Awaited<ReturnType<typeof startMcpHttpServer>> | undefined;

  afterEach(async () => {
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer!.server.close(() => resolve()));
      httpServer = undefined;
    }
  });

  it("serves /health and MCP tool calls over Streamable HTTP", async () => {
    httpServer = await startMcpHttpServer({
      name: "testers",
      port: 0,
      createMcpServer: createTestMcpServer,
    });
    const { port, host } = httpServer;

    const health = await fetch(`http://${host}:${port}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok", name: "testers" });

    const client = new Client({ name: "testers-http-test", version: "1.0.0" }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(`http://${host}:${port}/mcp`));

    try {
      await client.connect(transport, { timeout: 15_000 });
      const result = await client.callTool(
        { name: "list_scenarios", arguments: {} },
        undefined,
        { timeout: 15_000 },
      );
      expect(result.content[0]?.type).toBe("text");
      expect(result.content[0]?.type === "text" ? result.content[0].text : "").toBe("[]");
    } finally {
      await transport.close();
    }
  });

  it("handles concurrent HTTP clients in one process", async () => {
    httpServer = await startMcpHttpServer({
      name: "testers",
      port: 0,
      createMcpServer: createTestMcpServer,
    });
    const { port, host } = httpServer;

    const runClient = async () => {
      const client = new Client({ name: "testers-http-concurrent", version: "1.0.0" }, { capabilities: {} });
      const transport = new StreamableHTTPClientTransport(new URL(`http://${host}:${port}/mcp`));
      try {
        await client.connect(transport, { timeout: 15_000 });
        const result = await client.callTool(
          { name: "describe_tools", arguments: {} },
          undefined,
          { timeout: 15_000 },
        );
        expect(result.content[0]?.type).toBe("text");
      } finally {
        await transport.close();
      }
    };

    await Promise.all([runClient(), runClient(), runClient()]);
  });
});

describe("testers-mcp transport mode helpers", () => {
  it("keeps HTTP opt-in and uses the documented default port", () => {
    const previous = process.env.MCP_HTTP;
    delete process.env.MCP_HTTP;

    try {
      expect(isHttpMode([])).toBe(false);
      expect(isHttpMode(["--http"])).toBe(true);
      process.env.MCP_HTTP = "1";
      expect(isHttpMode([])).toBe(true);
      expect(resolveMcpHttpPort()).toBe(DEFAULT_MCP_HTTP_PORT);
      expect(DEFAULT_MCP_HTTP_PORT).toBe(8880);
    } finally {
      if (previous === undefined) {
        delete process.env.MCP_HTTP;
      } else {
        process.env.MCP_HTTP = previous;
      }
    }
  });
});

describe("testers MCP buildServer", () => {
  it("constructs and registers tools without duplicate names", () => {
    const entry = new URL("./server.ts", import.meta.url).pathname;
    const source = require("node:fs").readFileSync(entry, "utf8");
    const names = [...source.matchAll(/server\.tool\(\s*["']([^"']+)["']/g)].map((match: RegExpMatchArray) => match[1]);
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
    expect(duplicates).toEqual([]);
  });
});
