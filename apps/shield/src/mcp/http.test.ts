import { afterEach, describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Server } from "node:http";

import { buildServer, createMcpServer, resetServerForTests } from "./build-server.js";
import { getListeningPort, startMcpHttpServer } from "./http.js";

describe("buildServer", () => {
  afterEach(() => {
    resetServerForTests();
  });

  it("constructs a server and registers tools", async () => {
    const server = buildServer();
    expect(server).toBeDefined();
    expect(buildServer()).toBe(server);

    const transport = new StreamableHTTPClientTransport(new URL("http://127.0.0.1:1/mcp"));
    // Use in-process round-trip via a real HTTP server instead
    let httpServer: Server | undefined;
    try {
      httpServer = await startMcpHttpServer({
        port: 0,
        healthName: "security",
        createServer: createMcpServer,
      });
      const port = getListeningPort(httpServer);
      const clientTransport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
      const client = new Client({ name: "test", version: "1.0.0" });
      await client.connect(clientTransport);
      const { tools } = await client.listTools();
      expect(tools.some((t) => t.name === "list_agents")).toBe(true);
      await client.close();
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer?.close((err) => (err ? reject(err) : resolve()));
      });
      await transport.close();
    }
  });
});

describe("startMcpHttpServer", () => {
  let httpServer: Server | undefined;

  afterEach(async () => {
    resetServerForTests();
    if (httpServer) {
      await new Promise<void>((resolve, reject) => {
        httpServer!.close((err) => (err ? reject(err) : resolve()));
      });
      httpServer = undefined;
    }
  });

  it("serves GET /health", async () => {
    httpServer = await startMcpHttpServer({
      port: 0,
      healthName: "security",
      createServer: createMcpServer,
    });
    const port = getListeningPort(httpServer);
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", name: "security" });
  });

  it("handles MCP initialize and tool call over Streamable HTTP", async () => {
    httpServer = await startMcpHttpServer({
      port: 0,
      healthName: "security",
      createServer: createMcpServer,
    });
    const port = getListeningPort(httpServer);
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(transport);

    const result = await client.callTool({ name: "list_agents", arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.content).toBeDefined();

    await client.close();
  });

  it("serves multiple concurrent clients from one process", async () => {
    httpServer = await startMcpHttpServer({
      port: 0,
      healthName: "security",
      createServer: createMcpServer,
    });
    const port = getListeningPort(httpServer);

    const clients = await Promise.all(
      Array.from({ length: 3 }, async () => {
        const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
        const client = new Client({ name: "test", version: "1.0.0" });
        await client.connect(transport);
        return client;
      }),
    );

    const results = await Promise.all(
      clients.map((client) => client.callTool({ name: "list_agents", arguments: {} })),
    );
    expect(results).toHaveLength(3);
    for (const result of results) {
      expect(result.isError).not.toBe(true);
    }

    await Promise.all(clients.map((client) => client.close()));
  });
});
