import { describe, test, expect, afterAll } from "bun:test";
import type { Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import { startMcpHttpServer, resolveMcpHttpPort, DEFAULT_MCP_HTTP_PORT } from "./http.js";

const TEST_PORT = 18846;

// Stub factory: the real createServer() pulls in better-sqlite3 (node-only native
// addon, unsupported under the bun test runtime), so the HTTP transport wiring is
// verified here against a minimal in-memory server instead.
function buildStubServer(): McpServer {
  const server = new McpServer({ name: "terminal", version: "0.0.0" });
  server.registerTool(
    "ping",
    { title: "Ping", description: "Health check tool", inputSchema: { msg: z.string() } },
    async ({ msg }) => ({ content: [{ type: "text", text: `pong:${msg}` }] }),
  );
  return server;
}

function parseToolJson(result: any): any {
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0]?.text ?? "{}");
}

describe("terminal MCP HTTP transport", () => {
  let httpServer: Server | undefined;

  afterAll(() => {
    httpServer?.close();
  });

  test("default port is 8846 and --port overrides", () => {
    expect(DEFAULT_MCP_HTTP_PORT).toBe(8846);
    expect(resolveMcpHttpPort([])).toBe(8846);
    expect(resolveMcpHttpPort(["--port", "9001"])).toBe(9001);
  });

  test("GET /health returns 200", async () => {
    httpServer = await startMcpHttpServer({
      name: "terminal",
      port: TEST_PORT,
      buildServer: buildStubServer,
    });
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", name: "terminal" });
  });

  test("MCP initialize + list/call tools over Streamable HTTP", async () => {
    const client = new Client({ name: "terminal-http-test", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${TEST_PORT}/mcp`),
    );
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.some((t) => t.name === "ping")).toBe(true);
    const result = await client.callTool({ name: "ping", arguments: { msg: "hi" } });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toBe("pong:hi");
    await client.close();
  });

  test("real terminal MCP server initializes over Streamable HTTP under Bun", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "terminal-mcp-http-"));
    const previousDbPath = process.env.HASNA_TERMINAL_DB_PATH;
    process.env.HASNA_TERMINAL_DB_PATH = join(tempDir, "sessions.db");

    let realServer: Server | undefined;
    const client = new Client({ name: "terminal-real-http-test", version: "0.0.0" });
    try {
      const { createServer } = await import("./server.js");
      realServer = await startMcpHttpServer({
        name: "terminal",
        port: TEST_PORT + 1,
        buildServer: createServer,
      });
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${TEST_PORT + 1}/mcp`),
      );
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.some((t) => t.name === "execute")).toBe(true);

      const compactSnapshot = parseToolJson(await client.callTool({ name: "snapshot", arguments: {} }));
      expect(compactSnapshot.totals).toBeDefined();
      expect(compactSnapshot.recentCommands.length).toBeLessThanOrEqual(5);
      expect(compactSnapshot.hint).toContain("full=true");

      const fullSnapshot = parseToolJson(await client.callTool({ name: "snapshot", arguments: { full: true } }));
      expect(fullSnapshot.cwd).toBe(process.cwd());
      expect(fullSnapshot.env).toBeDefined();
      expect(fullSnapshot.totals).toBeUndefined();

      const readDir = mkdtempSync(join(tempDir, "read-files-"));
      const bigContent = Array.from({ length: 200 }, (_, i) => `line ${i} ${"x".repeat(80)}`).join("\n");
      const readPaths = Array.from({ length: 10 }, (_, i) => {
        const file = join(readDir, `file-${i}.txt`);
        writeFileSync(file, bigContent);
        return file;
      });
      const readFiles = parseToolJson(await client.callTool({ name: "read_files", arguments: { files: readPaths } }));
      expect(readFiles.__meta.returned).toBe(10);
      expect(readFiles.__meta.truncated).toBe(true);
      expect(readFiles[readPaths[0]].content.length).toBeLessThan(1600);
      expect(JSON.stringify(readFiles).length).toBeLessThan(20000);

      const browse = parseToolJson(await client.callTool({ name: "browse", arguments: { path: "src", recursive: true, limit: 5 } }));
      expect(browse.files.length).toBeLessThanOrEqual(5);
      expect(browse.returned).toBeLessThanOrEqual(5);

      const repoState = parseToolJson(await client.callTool({ name: "repo_state", arguments: { limit: 5 } }));
      expect(repoState.totals).toBeDefined();
      expect(repoState.hint).toContain("verbose=true");

      const agents = parseToolJson(await client.callTool({ name: "list_agents", arguments: { limit: 1 } }));
      expect(Array.isArray(agents.agents)).toBe(true);
      expect(agents.returned).toBeLessThanOrEqual(1);
      expect(agents.total).toBeGreaterThanOrEqual(agents.returned);
      await client.close();
    } finally {
      realServer?.close();
      process.env.HASNA_TERMINAL_DB_PATH = previousDbPath;
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
