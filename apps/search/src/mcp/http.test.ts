import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { type Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { closeDb } from "../db/database.js";
import { createResults } from "../db/results.js";
import { createSearch } from "../db/searches.js";
import { buildServer, MCP_NAME } from "./server.js";
import { handleMcpHttpRoutes, healthPayload, startMcpHttpServer } from "./http.js";

let httpServer: Server;
let port: number;

beforeAll(async () => {
  process.env["SEARCH_DB_PATH"] = ":memory:";
  httpServer = startMcpHttpServer({ port: 0 });
  await new Promise<void>((resolve) => {
    httpServer.once("listening", () => resolve());
  });
  const address = httpServer.address();
  port = typeof address === "object" && address ? address.port : 0;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    httpServer.close((err) => (err ? reject(err) : resolve()));
  });
  closeDb();
  delete process.env["SEARCH_DB_PATH"];
});

describe("MCP HTTP transport", () => {
  it("GET /health returns 200 with service name", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(healthPayload());
  });

  it("performs initialize + tool call over Streamable HTTP", async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
    );
    const client = new Client({ name: "search-http-test", version: "1.0.0" });
    await client.connect(transport);

    const result = await client.callTool({ name: "get_stats", arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.content?.[0]?.type).toBe("text");

    await client.close();
  });

  it("returns compact MCP result lists by default and full records with verbose", async () => {
    const search = createSearch({
      query: `mcp compact result query ${"long-query ".repeat(20)}full-tail`,
      providers: ["google"],
      resultCount: 25,
      duration: 50,
    });
    createResults(
      Array.from({ length: 25 }, (_, index) => ({
        searchId: search.id,
        title: `Long result title ${index} ${"title-fragment ".repeat(12)}full-title-tail`,
        url: `https://example.com/${index}/${"path-fragment/".repeat(16)}full-url-tail`,
        snippet: `Long snippet ${index} ${"snippet-fragment ".repeat(30)}full-snippet-tail`,
        source: "google" as const,
        provider: "google",
        rank: index + 1,
        metadata: { large: "metadata-fragment ".repeat(40) },
      })),
    );

    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
    );
    const client = new Client({ name: "search-http-test", version: "1.0.0" });
    await client.connect(transport);

    const compactResult = await client.callTool({
      name: "list_results",
      arguments: { search_id: search.id },
    });
    const compactText = compactResult.content?.[0]?.type === "text" ? compactResult.content[0].text : "";
    const compact = JSON.parse(compactText) as {
      total: number;
      returned: number;
      items: Array<{ snippet: string; metadata?: unknown }>;
      hint: string;
    };
    expect(compact.total).toBe(25);
    expect(compact.returned).toBe(20);
    expect((compact as { nextOffset?: number }).nextOffset).toBe(20);
    expect(compact.items[0]?.snippet).not.toContain("full-snippet-tail");
    expect(compact.items[0]?.metadata).toBeUndefined();
    expect(compact.hint).toContain("verbose:true");

    const verboseResult = await client.callTool({
      name: "list_results",
      arguments: { search_id: search.id, limit: 25, verbose: true },
    });
    const verboseText = verboseResult.content?.[0]?.type === "text" ? verboseResult.content[0].text : "";
    const verbose = JSON.parse(verboseText) as {
      returned: number;
      items: Array<{ snippet: string; metadata?: { large?: string } }>;
    };
    expect(verbose.returned).toBe(25);
    expect(verbose.items[0]?.snippet).toContain("full-snippet-tail");
    expect(verbose.items[0]?.metadata?.large).toContain("metadata-fragment");

    const filteredResult = await client.callTool({
      name: "list_results",
      arguments: { search_id: search.id, source: "google" },
    });
    const filteredText = filteredResult.content?.[0]?.type === "text" ? filteredResult.content[0].text : "";
    const filtered = JSON.parse(filteredText) as {
      total: number;
      returned: number;
      nextOffset?: number;
    };
    expect(filtered.total).toBe(25);
    expect(filtered.returned).toBe(20);
    expect(filtered.nextOffset).toBe(20);

    await client.close();
  });

  it("handleMcpHttpRoutes mounts /health for Bun.serve reuse", async () => {
    const res = await handleMcpHttpRoutes(new Request("http://127.0.0.1/health"));
    expect(res?.status).toBe(200);
    expect(await res!.json()).toEqual(healthPayload());
  });

  it("buildServer registers tools for stdio mode", () => {
    const server = buildServer();
    expect(server).toBeDefined();
    expect(MCP_NAME).toBe("search");
  });
});
