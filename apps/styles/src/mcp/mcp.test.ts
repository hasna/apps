import { afterEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer, DEFAULT_MCP_HTTP_PORT, startHttpServer } from "./index.js";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resetDb, setDbPath } from "../lib/db.js";

describe("styles MCP transport", () => {
  afterEach(() => {
    resetDb();
  });

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

      const healthTool = tools.find((t) => t.name === "run_health_check");
      expect(JSON.stringify(healthTool?.inputSchema)).toContain("cursor");

      await client.close();
    });

    test("list_styles returns compact summaries by default", async () => {
      const server = buildServer();
      const client = new Client({ name: "test", version: "1.0.0" });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

      const result = await client.callTool({ name: "list_styles", arguments: {} });
      const content = result.content as Array<{ type: string; text?: string }>;
      const payload = JSON.parse(content[0]?.text ?? "{}") as {
        styles: Array<{ name: string; principleCount: number; principles?: string[] }>;
      };

      expect(payload.styles[0].name).toBe("minimalist");
      expect(payload.styles[0].principleCount).toBeGreaterThan(0);
      expect(payload.styles[0].principles).toBeUndefined();

      await client.close();
    });

    test("get_preferences truncates by default and supports verbose full values", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "styles-mcp-"));
      setDbPath(join(tempDir, "styles.db"));

      const server = buildServer();
      const client = new Client({ name: "test", version: "1.0.0" });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

      const value = "x".repeat(180);
      await client.callTool({
        name: "set_preference",
        arguments: { key: "long_pref", value, scope: "global" },
      });

      const compact = await client.callTool({ name: "get_preferences", arguments: {} });
      const compactText = (compact.content as Array<{ text?: string }>)[0]?.text ?? "{}";
      const compactPayload = JSON.parse(compactText) as { preferences: Array<{ key: string; value: string }> };
      expect(compactPayload.preferences.find((pref) => pref.key === "long_pref")?.value.length).toBeLessThan(value.length);

      const verbose = await client.callTool({ name: "get_preferences", arguments: { verbose: true } });
      const verboseText = (verbose.content as Array<{ text?: string }>)[0]?.text ?? "{}";
      const verbosePayload = JSON.parse(verboseText) as { preferences: Array<{ key: string; value: string }> };
      expect(verbosePayload.preferences.find((pref) => pref.key === "long_pref")?.value).toBe(value);

      await client.close();
      resetDb();
      rmSync(tempDir, { recursive: true, force: true });
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
      const content = result.content as Array<{ type: string; text?: string }>;
      expect(content[0]?.type).toBe("text");
      expect(content[0]?.text?.length).toBeGreaterThan(2);

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
        const content = result.content as Array<{ type: string }>;
        expect(content[0]?.type).toBe("text");
      }

      await Promise.all(clients.map((client) => client.close()));
    });
  });
});
