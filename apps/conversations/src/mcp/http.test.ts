import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { buildServer } from "./index.js";
import { handleMcpRequest, resolveMcpHttpPort, DEFAULT_MCP_HTTP_PORT } from "./http.js";
import { closeDb } from "../lib/db.js";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_DB = join(tmpdir(), `conversations-http-test-${Date.now()}.db`);

describe("conversations MCP HTTP transport", () => {
  let httpServer: ReturnType<typeof Bun.serve>;
  let port: number;

  beforeAll(() => {
    process.env.CONVERSATIONS_DB_PATH = TEST_DB;
    closeDb();

    httpServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/health" && req.method === "GET") {
          return Response.json({ status: "ok", name: "conversations" });
        }
        if (url.pathname === "/mcp") {
          return handleMcpRequest(req, () => buildServer(true));
        }
        return new Response("Not Found", { status: 404 });
      },
    });
    port = httpServer.port!;
  });

  afterAll(async () => {
    httpServer.stop();
    closeDb();
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        unlinkSync(TEST_DB + suffix);
      } catch {
        /* ok */
      }
    }
  });

  test("default port is 8856", () => {
    expect(DEFAULT_MCP_HTTP_PORT).toBe(8856);
    expect(resolveMcpHttpPort([])).toBe(8856);
    expect(resolveMcpHttpPort(["--port", "9003"])).toBe(9003);
  });

  test("GET /health returns 200", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", name: "conversations" });
  });

  test("MCP initialize + list_agents over Streamable HTTP", async () => {
    const client = new Client({ name: "conversations-http-test", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
    );
    await client.connect(transport);
    const result = await client.callTool({ name: "list_agents", arguments: {} });
    expect(result.isError).not.toBe(true);
    const content = result.content as Array<{ type: string }> | undefined;
    expect(content?.[0]?.type).toBe("text");
    await client.close();
  });

  test("serves multiple concurrent clients from one process", async () => {
    const clients = await Promise.all(
      [1, 2, 3].map(async () => {
        const client = new Client({ name: "conversations-http-concurrent", version: "0.0.0" });
        const transport = new StreamableHTTPClientTransport(
          new URL(`http://127.0.0.1:${port}/mcp`),
        );
        await client.connect(transport);
        const result = await client.callTool({ name: "list_agents", arguments: {} });
        await client.close();
        return result;
      }),
    );
    for (const result of clients) {
      expect(result.isError).not.toBe(true);
    }
  });
});

describe("conversations buildServer", () => {
  test("registers tools for stdio and HTTP modes", () => {
    expect(buildServer()).toBeDefined();
    expect(buildServer(true)).toBeDefined();
  });
});
