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
    const dbPath = `/tmp/test-crawl-mcp-http-${Date.now()}.db`;
    dbPaths.push(dbPath);
    process.env["CRAWL_DB_PATH"] = dbPath;
    process.env["HASNA_CRAWL_DB_PATH"] = dbPath;

    // Port 0 lets the OS assign an ephemeral port: a pre-picked random port
    // races every other process on the machine and intermittently fails the
    // suite with EADDRINUSE. startHttpServer returns the bound port.
    const server = await startHttpServer(buildServer, 0);
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${server.port}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", name: MCP_SERVER_NAME });
  });

  it("supports MCP initialize and tool call over streamable HTTP", async () => {
    const dbPath = `/tmp/test-crawl-mcp-roundtrip-${Date.now()}.db`;
    dbPaths.push(dbPath);
    process.env["CRAWL_DB_PATH"] = dbPath;
    process.env["HASNA_CRAWL_DB_PATH"] = dbPath;

    const server = await startHttpServer(buildServer, 0);
    servers.push(server);

    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`)));

    const result = await client.callTool({ name: "get_stats", arguments: {} });
    expect(result.isError).not.toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
    const stats = JSON.parse(text) as { totalCrawls: number };
    expect(typeof stats.totalCrawls).toBe("number");

    await client.close();
  });

  it("serves three concurrent MCP clients from one process", async () => {
    const dbPath = `/tmp/test-crawl-mcp-concurrent-${Date.now()}.db`;
    dbPaths.push(dbPath);
    process.env["CRAWL_DB_PATH"] = dbPath;
    process.env["HASNA_CRAWL_DB_PATH"] = dbPath;

    const server = await startHttpServer(buildServer, 0);
    servers.push(server);

    const clients = await Promise.all(
      Array.from({ length: 3 }, async () => {
        const client = new Client({ name: "test-client", version: "1.0.0" });
        await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`)));
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
    const dbPath = `/tmp/test-crawl-mcp-entry-${Date.now()}.db`;
    dbPaths.push(dbPath);

    const env = { ...process.env };
    env["CRAWL_DB_PATH"] = dbPath;
    env["HASNA_CRAWL_DB_PATH"] = dbPath;
    env["MCP_HTTP"] = "1";
    // Port 0 asks the OS for a free ephemeral port; a pre-picked random port
    // races every other process on the machine and fails the suite with
    // EADDRINUSE. The bound port is parsed from the entry's stderr banner.
    env["MCP_HTTP_PORT"] = "0";

    const proc = Bun.spawn([process.execPath, "run", "src/mcp/index.ts"], {
      cwd: repoRoot,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    processes.push(proc);

    // startCrawlServer writes "crawl server running on http://HOST:PORT"
    // to stdout once the socket is bound. Read incrementally until the banner
    // appears, then probe /health on the reported port.
    const port = await new Promise<number | null>((resolve) => {
      let buffered = "";
      const timer = setTimeout(() => resolve(null), 15_000);
      const pump = async () => {
        const reader = proc.stdout.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffered += new TextDecoder().decode(value);
            const match = buffered.match(/server running on http:\/\/[^:]+:(\d+)/);
            if (match) {
              clearTimeout(timer);
              resolve(Number(match[1]));
              reader.cancel().catch(() => {});
              return;
            }
          }
        } catch {
          // stream closed before the banner — fall through to resolve(null)
        }
        resolve(null);
      };
      pump().catch(() => resolve(null));
    });

    expect(port).not.toBeNull();
    let response: Response | undefined;
    if (port !== null) {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        try {
          response = await fetch(`http://127.0.0.1:${port}/health`);
          if (response.ok) break;
        } catch {
          await Bun.sleep(100);
        }
      }
    }

    expect(response?.ok).toBe(true);
    expect(await response!.json()).toEqual({ status: "ok", name: MCP_SERVER_NAME });
  }, 30_000);
});
