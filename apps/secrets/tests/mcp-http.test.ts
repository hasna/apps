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
    testDir = join(tmpdir(), `open-secrets-http-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

  test("MCP initialize + set/get a secret over Streamable HTTP", async () => {
    const client = new Client({ name: "secrets-http-test", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
    );
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.some((t) => t.name === "get_secret")).toBe(true);
    expect(tools.tools.some((t) => t.name === "inspect_secret")).toBe(true);

    await client.callTool({ name: "set_secret", arguments: { key: "test/key", value: "s3cret" } });
    const got = await client.callTool({ name: "get_secret", arguments: { key: "test/key" } });
    const content = got.content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toContain("s3cret");
    await client.close();
  });

  test("MCP list_secrets is compact and paginated by default", async () => {
    const client = new Client({ name: "secrets-http-compact-test", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
    );
    await client.connect(transport);

    for (let i = 1; i <= 25; i++) {
      const suffix = String(i).padStart(2, "0");
      await client.callTool({
        name: "set_secret",
        arguments: {
          key: `mcp-compact/service/prod/token-${suffix}`,
          value: `secret-value-${suffix}`,
          type: "token",
          label: `MCP compact token ${suffix}`,
        },
      });
    }

    const listed = await client.callTool({
      name: "list_secrets",
      arguments: { namespace: "mcp-compact" },
    });
    const content = listed.content as Array<{ type: string; text: string }>;
    const text = content[0]?.text ?? "";

    expect(text).toContain("Showing 1-20 of 25 secrets.");
    expect(text).toContain('Next: call list_secrets with {"cursor":20,"limit":20}');
    expect(text).toContain('Details: call inspect_secret with {"key":"<key>"}');
    expect(text).not.toContain("secret-value-01");
    expect(text.split("\n").filter((line) => line.includes("mcp-compact/service/prod/token-")).length).toBe(20);

    const inspected = await client.callTool({
      name: "inspect_secret",
      arguments: { key: "mcp-compact/service/prod/token-01" },
    });
    const inspectContent = inspected.content as Array<{ type: string; text: string }>;
    expect(inspectContent[0]?.text).toContain('call get_secret with {"key":"mcp-compact/service/prod/token-01"}');
    expect(inspectContent[0]?.text).not.toContain("secret-value-01");
    await client.close();
  });
});
