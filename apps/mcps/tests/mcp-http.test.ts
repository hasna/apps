import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import "./setup";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { closeDb, getDb } from "../src/lib/db";
import { buildServer } from "../src/mcp/server";
import { DEFAULT_HTTP_PORT, HTTP_NAME, isHttpMode, resolveHttpPort, startHttpServer } from "../src/mcp/http";

let httpServer: ReturnType<typeof startHttpServer> | undefined;
let httpPort = 0;

function clearDb() {
  const db = getDb();
  db.exec("DELETE FROM tool_cache");
  db.exec("DELETE FROM servers");
}

describe("MCP HTTP transport", () => {
  beforeEach(() => {
    clearDb();
  });
  it("stdio mode still builds and registers tools", async () => {
    const server = buildServer({ name: "mcps-test", version: "0.0.1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "stdio-test", version: "0.0.1" });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain("list_servers");

    await client.close();
    await server.close();
  });

  it("resolves HTTP mode and default port", () => {
    expect(isHttpMode(["--http"])).toBe(true);
    expect(resolveHttpPort([])).toBe(DEFAULT_HTTP_PORT);
    expect(HTTP_NAME).toBe("mcps");
  });

  it("resolves explicit HTTP ports and rejects malformed values", () => {
    expect(resolveHttpPort(["--port", "9123"])).toBe(9123);
    expect(resolveHttpPort(["--port=9124"])).toBe(9124);

    for (const raw of ["0", "65536", "12.5", "123abc", "abc"]) {
      expect(() => resolveHttpPort(["--port", raw])).toThrow(`Invalid port: ${raw}`);
    }

    expect(() => resolveHttpPort(["--port"])).toThrow("Missing value for --port");
    expect(() => resolveHttpPort(["--port", "--stdio"])).toThrow("Missing value for --port");
  });

  it("validates MCP_HTTP_PORT using the same strict rules", () => {
    const previous = process.env.MCP_HTTP_PORT;
    try {
      process.env.MCP_HTTP_PORT = "4477";
      expect(resolveHttpPort([])).toBe(4477);

      process.env.MCP_HTTP_PORT = "4477x";
      expect(() => resolveHttpPort([])).toThrow("Invalid port: 4477x");
    } finally {
      if (previous === undefined) delete process.env.MCP_HTTP_PORT;
      else process.env.MCP_HTTP_PORT = previous;
    }
  });

  it("GET /health returns ok", async () => {
    httpServer = startHttpServer({ port: 0, host: "127.0.0.1" });
    await Bun.sleep(100);
    const address = httpServer.address();
    httpPort = typeof address === "object" && address ? address.port : 0;

    const res = await fetch(`http://127.0.0.1:${httpPort}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", name: "mcps" });
  });

  it("handles MCP initialize and tool call over Streamable HTTP", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${httpPort}/mcp`));
    const client = new Client({ name: "http-test", version: "0.0.1" });
    await client.connect(transport);

    const result = await client.callTool({ name: "list_servers", arguments: {} });
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(JSON.parse(text)).toMatchObject({
      items: [],
      total: 0,
      shown: 0,
      nextCursor: null,
    });

    await client.close();
  });

  it("serves multiple concurrent HTTP clients from one process", async () => {
    const clients = await Promise.all(
      Array.from({ length: 3 }, async (_, index) => {
        const transport = new StreamableHTTPClientTransport(
          new URL(`http://127.0.0.1:${httpPort}/mcp`)
        );
        const client = new Client({ name: `http-test-${index}`, version: "0.0.1" });
        await client.connect(transport);
        return client;
      })
    );

    const results = await Promise.all(
      clients.map((client) => client.callTool({ name: "list_servers", arguments: {} }))
    );

    expect(results).toHaveLength(3);
    await Promise.all(clients.map((client) => client.close()));
  });
});

afterAll(() => {
  httpServer?.close();
  closeDb();
});
