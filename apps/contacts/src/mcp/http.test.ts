import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { buildServer } from "./index.js";
import { handleMcpRequest, resolveMcpHttpPort, DEFAULT_MCP_HTTP_PORT } from "./http.js";

describe("contacts MCP HTTP transport", () => {
  let httpServer: ReturnType<typeof Bun.serve>;
  let port: number;

  beforeAll(() => {
    httpServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/health" && req.method === "GET") {
          return Response.json({ status: "ok", name: "contacts" });
        }
        if (url.pathname === "/mcp") {
          return handleMcpRequest(req, buildServer);
        }
        return new Response("Not Found", { status: 404 });
      },
    });
    port = httpServer.port!;
  });

  afterAll(() => {
    httpServer.stop();
  });

  test("default port is 8809", () => {
    expect(DEFAULT_MCP_HTTP_PORT).toBe(8809);
    expect(resolveMcpHttpPort([])).toBe(8809);
    expect(resolveMcpHttpPort(["--port", "9001"])).toBe(9001);
  });

  test("GET /health returns 200", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", name: "contacts" });
  });

  test("MCP initialize succeeds but data access fails closed when unconfigured", async () => {
    const client = new Client({ name: "contacts-http-test", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
    );
    await client.connect(transport);
    const result = await client.callTool({ name: "list_tags", arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/CONTACTS_API_NOT_CONFIGURED|RETIRED_CONTACTS_CLIENT_SELECTOR/);
    await client.close();
  });

  test("fails closed consistently for multiple concurrent clients", async () => {
    const clients = await Promise.all(
      [1, 2, 3].map(async () => {
        const client = new Client({ name: "contacts-http-concurrent", version: "0.0.0" });
        const transport = new StreamableHTTPClientTransport(
          new URL(`http://127.0.0.1:${port}/mcp`),
        );
        await client.connect(transport);
        const result = await client.callTool({ name: "list_tags", arguments: {} });
        await client.close();
        return result;
      }),
    );
    for (const result of clients) {
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toMatch(/CONTACTS_API_NOT_CONFIGURED|RETIRED_CONTACTS_CLIENT_SELECTOR/);
    }
  });
});

describe("contacts buildServer", () => {
  test("registers tools for stdio and HTTP modes", () => {
    expect(buildServer()).toBeDefined();
  });
});
