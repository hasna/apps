import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, unlinkSync } from "fs";
import { join } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "./index.js";
import {
  MCP_SERVER_NAME,
  resetMcpHttpStateForTests,
  startHttpServer,
} from "./http.js";

const repoRoot = join(import.meta.dir, "../..");
const processes: Bun.Subprocess[] = [];
const dbPaths: string[] = [];
const servers: Array<{ stop: () => void }> = [];

function randomPort(): number {
  return 30000 + Math.floor(Math.random() * 20000);
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.stop();
  }
  resetMcpHttpStateForTests();

  for (const proc of processes.splice(0)) {
    proc.kill();
    await proc.exited.catch(() => {});
  }

  for (const dbPath of dbPaths.splice(0)) {
    if (existsSync(dbPath)) {
      unlinkSync(dbPath);
    }
  }

  delete process.env["CRAWL_DB_PATH"];
  delete process.env["HASNA_CRAWL_DB_PATH"];
  const { closeDb } = await import("../db/database.js");
  closeDb();
});

describe("MCP HTTP transport", () => {
  it("GET /health returns 200 with service name", async () => {
    const port = randomPort();
    const dbPath = `/tmp/test-crawl-mcp-http-${Date.now()}.db`;
    dbPaths.push(dbPath);
    process.env["CRAWL_DB_PATH"] = dbPath;
    process.env["HASNA_CRAWL_DB_PATH"] = dbPath;

    const server = await startHttpServer(buildServer, port);
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${port}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", name: MCP_SERVER_NAME });
  });

  it("supports MCP initialize and tool call over streamable HTTP", async () => {
    const port = randomPort();
    const dbPath = `/tmp/test-crawl-mcp-roundtrip-${Date.now()}.db`;
    dbPaths.push(dbPath);
    process.env["CRAWL_DB_PATH"] = dbPath;
    process.env["HASNA_CRAWL_DB_PATH"] = dbPath;

    const server = await startHttpServer(buildServer, port);
    servers.push(server);

    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));

    const result = await client.callTool({ name: "get_stats", arguments: {} });
    expect(result.isError).not.toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
    const stats = JSON.parse(text) as { totalCrawls: number };
    expect(typeof stats.totalCrawls).toBe("number");

    await client.close();
  });

  it("serves three concurrent MCP clients from one process", async () => {
    const port = randomPort();
    const dbPath = `/tmp/test-crawl-mcp-concurrent-${Date.now()}.db`;
    dbPaths.push(dbPath);
    process.env["CRAWL_DB_PATH"] = dbPath;
    process.env["HASNA_CRAWL_DB_PATH"] = dbPath;

    const server = await startHttpServer(buildServer, port);
    servers.push(server);

    const clients = await Promise.all(
      Array.from({ length: 3 }, async () => {
        const client = new Client({ name: "test-client", version: "1.0.0" });
        await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
        return client;
      }),
    );

    const results = await Promise.all(
      clients.map((client) => client.callTool({ name: "list_crawls", arguments: { limit: 1 } })),
    );

    for (const result of results) {
      expect(result.isError).not.toBe(true);
    }

    await Promise.all(clients.map((client) => client.close()));
  });
});

describe("stdio mode", () => {
  it("buildServer registers tools for in-memory transport", async () => {
    const dbPath = `/tmp/test-crawl-mcp-stdio-${Date.now()}.db`;
    dbPaths.push(dbPath);
    process.env["CRAWL_DB_PATH"] = dbPath;
    process.env["HASNA_CRAWL_DB_PATH"] = dbPath;

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await buildServer().connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === "get_stats")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "list_crawls")).toBe(true);

    await client.close();
  });
});

describe("crawl-mcp --http entry", () => {
  it("starts HTTP mode on an ephemeral port", async () => {
    const port = randomPort();
    const dbPath = `/tmp/test-crawl-mcp-entry-${Date.now()}.db`;
    dbPaths.push(dbPath);

    const env = { ...process.env };
    env["CRAWL_DB_PATH"] = dbPath;
    env["HASNA_CRAWL_DB_PATH"] = dbPath;
    env["MCP_HTTP"] = "1";
    env["MCP_HTTP_PORT"] = String(port);

    const proc = Bun.spawn([process.execPath, "run", "src/mcp/index.ts"], {
      cwd: repoRoot,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    processes.push(proc);

    const deadline = Date.now() + 10_000;
    let response: Response | undefined;
    while (Date.now() < deadline) {
      try {
        response = await fetch(`http://127.0.0.1:${port}/health`);
        if (response.ok) break;
      } catch {
        await Bun.sleep(100);
      }
    }

    expect(response?.ok).toBe(true);
    expect(await response!.json()).toEqual({ status: "ok", name: MCP_SERVER_NAME });
  });
});
