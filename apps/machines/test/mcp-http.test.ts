import { afterAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer, createMcpServer, MACHINE_MCP_TOOL_NAMES } from "../src/mcp/server.js";
import { DEFAULT_HTTP_PORT, HTTP_NAME, isHttpMode, resolveHttpPort, startHttpServer } from "../src/mcp/http.js";

let httpServer: ReturnType<typeof startHttpServer> | undefined;
let httpPort = 0;

describe("MCP HTTP transport", () => {
  test("stdio mode still builds and registers tools", async () => {
    const server = buildServer("0.0.1");
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "stdio-test", version: "0.0.1" });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([...MACHINE_MCP_TOOL_NAMES].sort());

    await client.close();
    await server.close();
  });

  test("createMcpServer remains available for callers", () => {
    expect(createMcpServer("0.0.1")).toBeDefined();
  });

  test("resolves HTTP mode and default port", () => {
    expect(isHttpMode(["--http"])).toBe(true);
    expect(resolveHttpPort([])).toBe(DEFAULT_HTTP_PORT);
    expect(HTTP_NAME).toBe("machines");
  });

  test("GET /health returns ok", async () => {
    httpServer = startHttpServer({ port: 0, host: "127.0.0.1" });
    await Bun.sleep(100);
    const address = httpServer.address();
    httpPort = typeof address === "object" && address ? address.port : 0;

    const res = await fetch(`http://127.0.0.1:${httpPort}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "ok",
      name: "machines",
    });
  });

  test("handles MCP initialize and tool call over Streamable HTTP", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${httpPort}/mcp`));
    const client = new Client({ name: "http-test", version: "0.0.1" });
    await client.connect(transport);

    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === "machines_status")).toBe(true);

    const result = await client.callTool({ name: "machines_status", arguments: {} });
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(text).toBeTruthy();
    expect(JSON.parse(text)).toMatchObject({ machineId: expect.any(String) });

    await client.close();
  });

  test("serves multiple concurrent HTTP clients from one process", async () => {
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
      clients.map((client) => client.callTool({ name: "machines_self_test", arguments: {} }))
    );

    expect(results).toHaveLength(3);
    for (const result of results) {
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
      expect(JSON.parse(text)).toMatchObject({ checks: expect.any(Array) });
    }

    await Promise.all(clients.map((client) => client.close()));
  });
});

afterAll(() => {
  httpServer?.close();
});
