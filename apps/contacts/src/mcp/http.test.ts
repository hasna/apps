import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { buildServer } from "./index.js";
import { resetStoreCache } from "../store/index.js";
import { resetDatabase } from "../db/database.js";
import { handleMcpRequest, resolveMcpHttpPort, DEFAULT_MCP_HTTP_PORT } from "./http.js";

describe("contacts MCP HTTP transport", () => {
  let httpServer: ReturnType<typeof Bun.serve>;
  let port: number;

  const envNames = [
    "HASNA_CONTACTS_API_URL",
    "CONTACTS_API_URL",
    "HASNA_CONTACTS_API_KEY",
    "CONTACTS_API_KEY",
    "HASNA_CONTACTS_API_KEY_OVERRIDE",
    "HASNA_CONTACTS_API_KEY_REF",
    "HASNA_PROFILE",
    "HASNA_STATION",
    "HASNA_HOME",
    "HASNA_CONFIG_HOME",
    "HASNA_CONTACTS_STORAGE_MODE",
    "CONTACTS_STORAGE_MODE",
    "HASNA_CONTACTS_DB_PATH",
    "CONTACTS_DB_PATH",
    "HASNA_CONTACTS_DATABASE_URL",
    "CONTACTS_DATABASE_URL",
  ] as const;

  function isolateLocalData() {
    for (const name of envNames) delete process.env[name];
    const tempHome = mkdtempSync(join(tmpdir(), "contacts-mcp-http-home-"));
    process.env.HOME = tempHome;
    process.env.HASNA_HOME = join(tempHome, ".hasna");
    process.env.HASNA_STATION = "no-such-station";
    resetStoreCache();
    resetDatabase();
    return tempHome;
  }

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

  test("MCP initialize succeeds and data tools work against the local store when unconfigured", async () => {
    const tempHome = isolateLocalData();
    try {
      const client = new Client({ name: "contacts-http-test", version: "0.0.0" });
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${port}/mcp`),
      );
      await client.connect(transport);
      const result = await client.callTool({ name: "list_tags", arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(JSON.stringify(result.content)).toContain("[]");
      const status = await client.callTool({ name: "contacts_connection_status", arguments: {} });
      const statusPayload = JSON.parse((status.content as Array<{ text: string }>)[0]!.text) as { active_transport?: string };
      expect(statusPayload.active_transport).toBe("local");
      await client.close();
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  });

  test("works consistently for multiple concurrent clients on the local transport", async () => {
    const tempHome = isolateLocalData();
    try {
      const results = await Promise.all(
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
      for (const result of results) {
        expect(result.isError).not.toBe(true);
        expect(JSON.stringify(result.content)).toContain("[]");
      }
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  });
});

describe("contacts buildServer", () => {
  test("registers tools for stdio and HTTP modes", () => {
    expect(buildServer()).toBeDefined();
  });
});
