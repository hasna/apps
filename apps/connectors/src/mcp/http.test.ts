import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadConnectorVersions } from "../lib/registry.js";
import { buildServer } from "./server.js";
import {
  healthPayload,
  isHttpMode,
  resolveHttpPort,
  startMcpHttpServer,
} from "./http.js";

const TEST_DIR = join(import.meta.dir, "..", "..", ".test-mcp-http-tmp");
const servers: Array<{ stop: () => void }> = [];

function cleanup() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
}

beforeEach(() => {
  cleanup();
  mkdirSync(TEST_DIR, { recursive: true });
  loadConnectorVersions();
});

afterEach(() => {
  while (servers.length > 0) {
    servers.pop()?.stop();
  }
  cleanup();
});

describe("connectors MCP HTTP transport", () => {
  it("isHttpMode and resolveHttpPort work", () => {
    expect(isHttpMode(["--http"])).toBe(true);
    expect(resolveHttpPort([])).toBe(8854);
  });

  it("buildServer constructs a server", async () => {
    const server = buildServer();
    expect(server).toBeDefined();
    await server.close();
  });

  it("GET /health returns ok payload", async () => {
    const { port, stop } = await startMcpHttpServer(0);
    servers.push({ stop });
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(healthPayload());
  });

  it("handles MCP initialize + list_categories over Streamable HTTP", async () => {
    const { port, stop } = await startMcpHttpServer(0);
    servers.push({ stop });

    const client = new Client(
      { name: "connectors-http-test", version: "1.0.0" },
      { capabilities: {} }
    );
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`)
    );

    try {
      await client.connect(transport, { timeout: 15_000 });
      const tools = await client.listTools(undefined, { timeout: 15_000 });
      const toolNames = tools.tools.map((tool) => tool.name);
      expect(toolNames).toContain("list_categories");
      expect(toolNames).toContain("storage_status");
      expect(toolNames).toContain("storage_push");
      expect(toolNames).toContain("storage_pull");
      expect(toolNames).not.toContain("storage_sync");

      const result = await client.callTool(
        { name: "list_categories", arguments: {} },
        undefined,
        { timeout: 15_000 }
      );
      const content = result.content as Array<{ type?: string; text?: string }>;
      expect(content[0]?.type).toBe("text");
      const text = content[0]?.text ?? "";
      expect(text).toContain("categories");
    } finally {
      try {
        await client.close();
      } catch {
        // Stateless HTTP may already have closed the session.
      }
    }
  });

  it("serves three concurrent MCP clients from one process", async () => {
    const { port, stop } = await startMcpHttpServer(0);
    servers.push({ stop });

    async function callCategories() {
      const client = new Client(
        { name: "connectors-http-concurrent", version: "1.0.0" },
        { capabilities: {} }
      );
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${port}/mcp`)
      );
      await client.connect(transport, { timeout: 15_000 });
      const result = await client.callTool({ name: "list_categories", arguments: {} }, undefined, {
        timeout: 15_000,
      });
      try {
        await client.close();
      } catch {
        // Stateless HTTP may already have closed the session.
      }
      return result;
    }

    const results = await Promise.all([
      callCategories(),
      callCategories(),
      callCategories(),
    ]);
    expect(
      results.every(
        (r) => (r.content as Array<{ type?: string }>)[0]?.type === "text"
      )
    ).toBe(true);
  });
});
