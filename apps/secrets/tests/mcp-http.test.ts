import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { buildServer } from "../src/mcp.js";
import { handleMcpRequest, resolveMcpHttpPort, DEFAULT_MCP_HTTP_PORT } from "../src/mcp-http.js";

describe("secrets MCP HTTP transport", () => {
  let httpServer: ReturnType<typeof Bun.serve>;
  let port: number;
  let testDir: string;

  beforeAll(() => {
    testDir = join(tmpdir(), `secrets-http-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    process.env.OPEN_SECRETS_DB = join(testDir, "vault.db");

    httpServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/health" && req.method === "GET") {
          return Response.json({ status: "ok", name: "secrets" });
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
    delete process.env.OPEN_SECRETS_DB;
    rmSync(testDir, { recursive: true, force: true });
  });

  test("default port is 8848", () => {
    expect(DEFAULT_MCP_HTTP_PORT).toBe(8848);
    expect(resolveMcpHttpPort([])).toBe(8848);
    expect(resolveMcpHttpPort(["--port", "9001"])).toBe(9001);
  });

  test("GET /health returns 200", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", name: "secrets" });
  });

  test("MCP initialize + tool listing + set/get over Streamable HTTP", async () => {
    const client = new Client({ name: "secrets-http-test", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
    );
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      "audit_log",
      "delete_secret",
      "delete_vault_item",
      "get_secret",
      "get_vault_item",
      "list_secrets",
      "list_users",
      "list_vault_items",
      "register_user",
      "scan_history_exposures",
      "scan_workspace_exposures",
      "search_secrets",
      "search_vault_items",
      "send_feedback",
      "set_secret",
      "set_vault_item",
    ]);

    const fixtureValue = "fixture-value-not-a-credential";
    await client.callTool({ name: "set_secret", arguments: { key: "test/key", value: fixtureValue } });
    const listed = await client.callTool({ name: "list_secrets", arguments: {} });
    expect(JSON.stringify(listed)).not.toContain(fixtureValue);
    const got = await client.callTool({ name: "get_secret", arguments: { key: "test/key" } });
    const content = got.content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toContain(fixtureValue);
    await client.close();
  });
});
