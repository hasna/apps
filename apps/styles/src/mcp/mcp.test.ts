import { afterEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer, DEFAULT_MCP_HTTP_PORT, startHttpServer } from "./index.js";

describe("styles MCP transport", () => {
  test("DEFAULT_MCP_HTTP_PORT is 8837", () => {
    expect(DEFAULT_MCP_HTTP_PORT).toBe(8837);
  });

  describe("buildServer", () => {
    test("registers tools via in-memory transport", async () => {
      const server = buildServer();
      const client = new Client({ name: "test", version: "1.0.0" });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain("list_styles");
      expect(names).toContain("get_style_info");

      await client.close();
    });
  });

  describe("HTTP mode", () => {
    let handle: Awaited<ReturnType<typeof startHttpServer>> | undefined;

    afterEach(async () => {
      if (handle) {
        await handle.close();
        handle = undefined;
      }
    });

    test("GET /health returns 200 with service name", async () => {
      handle = await startHttpServer({ port: 0 });
      const res = await fetch(`http://127.0.0.1:${handle.port}/health`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "ok", name: "styles" });
    });

    test("supports MCP initialize and list_styles over Streamable HTTP", async () => {
      handle = await startHttpServer({ port: 0 });
      const client = new Client({ name: "styles-http-test", version: "1.0.0" });
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${handle.port}/mcp`),
      );

      await client.connect(transport);

      const { tools } = await client.listTools();
      expect(tools.some((t) => t.name === "list_styles")).toBe(true);

      const result = await client.callTool({ name: "list_styles", arguments: {} });
      expect(result.content[0]?.type).toBe("text");
      const text = result.content[0]?.type === "text" ? result.content[0].text : "";
      expect(text.length).toBeGreaterThan(2);

      await client.close();
    });

    test("serves multiple concurrent clients from one process", async () => {
      handle = await startHttpServer({ port: 0 });
      const url = new URL(`http://127.0.0.1:${handle.port}/mcp`);

      const clients = await Promise.all(
        [1, 2, 3].map(async (n) => {
          const client = new Client({ name: `styles-http-${n}`, version: "1.0.0" });
          await client.connect(new StreamableHTTPClientTransport(url));
          return client;
        }),
      );

      const results = await Promise.all(
        clients.map((client) => client.callTool({ name: "list_styles", arguments: {} })),
      );

      for (const result of results) {
        expect(result.content[0]?.type).toBe("text");
      }

      await Promise.all(clients.map((client) => client.close()));
    });
  });
});
