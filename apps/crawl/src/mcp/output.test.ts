import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, unlinkSync } from "fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "./index.js";

const dbPaths: string[] = [];
const servers: Array<{ stop: () => void }> = [];

async function resetDb() {
  const { closeDb } = await import("../db/database.js");
  closeDb();
}

async function createDbPath(prefix: string) {
  const dbPath = `/tmp/test-crawl-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
  dbPaths.push(dbPath);
  process.env["CRAWL_DB_PATH"] = dbPath;
  process.env["HASNA_CRAWL_DB_PATH"] = dbPath;
  await resetDb();
  return dbPath;
}

async function callTool(name: string, args: Record<string, unknown>) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await buildServer().connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).not.toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
    return JSON.parse(text) as Record<string, unknown>;
  } finally {
    await client.close();
  }
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.stop();
  }
  await resetDb();
  for (const dbPath of dbPaths.splice(0)) {
    if (existsSync(dbPath)) {
      unlinkSync(dbPath);
    }
  }
  delete process.env["CRAWL_DB_PATH"];
  delete process.env["HASNA_CRAWL_DB_PATH"];
});

describe("MCP compact output", () => {
  it("paginates compact crawl and page lists with nextOffset", async () => {
    await createDbPath("mcp-pagination");
    const { createCrawl } = await import("../db/crawls.js");
    const { createPage } = await import("../db/pages.js");
    let crawlId = "";
    for (let i = 0; i < 25; i += 1) {
      const crawl = createCrawl({ url: `https://example.com/${i}` });
      if (i === 0) crawlId = crawl.id;
    }
    for (let i = 0; i < 25; i += 1) {
      createPage({ crawlId, url: `https://example.com/page-${i}`, title: `Page ${i}` });
    }

    const crawlsPage = await callTool("list_crawls", { limit: 10 });
    expect(crawlsPage["count"]).toBe(10);
    expect(crawlsPage["hasMore"]).toBe(true);
    expect(crawlsPage["nextOffset"]).toBe(10);

    const crawlsNextPage = await callTool("list_crawls", { limit: 10, offset: 10 });
    expect(crawlsNextPage["offset"]).toBe(10);
    expect(crawlsNextPage["count"]).toBe(10);

    const crawlDetails = await callTool("get_crawl", { id: crawlId, limit: 10 });
    expect(crawlDetails["pageCount"]).toBe(10);
    expect(crawlDetails["hasMorePages"]).toBe(true);
    expect(crawlDetails["nextOffset"]).toBe(10);

    const crawlDetailsNext = await callTool("get_crawl", { id: crawlId, limit: 10, offset: 10 });
    expect(crawlDetailsNext["offset"]).toBe(10);
    expect(crawlDetailsNext["pageCount"]).toBe(10);
  });

  it("paginates webhook MCP outputs and redacts payloads by default", async () => {
    await createDbPath("mcp-webhooks");
    const { createWebhook, createDelivery } = await import("../db/webhooks.js");
    let webhookId = "";
    for (let i = 0; i < 25; i += 1) {
      const webhook = createWebhook({ url: `https://example.com/webhook-${i}`, secret: `secret-${i}` });
      if (i === 0) webhookId = webhook.id;
    }
    for (let i = 0; i < 25; i += 1) {
      createDelivery({
        webhookId,
        event: "crawl.completed",
        payload: JSON.stringify({ token: `payload-${i}` }),
      });
    }

    const webhooks = await callTool("list_webhooks", { limit: 10 });
    expect(webhooks["count"]).toBe(10);
    expect(webhooks["hasMore"]).toBe(true);
    expect(webhooks["nextOffset"]).toBe(10);
    expect(JSON.stringify(webhooks)).not.toContain("secret-");

    const deliveries = await callTool("get_webhook_deliveries", { id: webhookId, limit: 10 });
    expect(deliveries["count"]).toBe(10);
    expect(deliveries["hasMore"]).toBe(true);
    expect(deliveries["nextOffset"]).toBe(10);
    expect(JSON.stringify(deliveries)).not.toContain("payload-");

    const verboseDeliveries = await callTool("get_webhook_deliveries", {
      id: webhookId,
      limit: 1,
      include_payloads: true,
    });
    expect(JSON.stringify(verboseDeliveries)).toContain("payload-");
  });

  it("returns compact get_page output by default and full records on request", async () => {
    await createDbPath("mcp-get-page");
    const { createCrawl } = await import("../db/crawls.js");
    const { createPage } = await import("../db/pages.js");
    const crawl = createCrawl({ url: "https://example.com" });
    const longBody = `# MCP compact output\n${"content ".repeat(220)}TAIL_MARKER`;
    const page = createPage({
      crawlId: crawl.id,
      url: "https://example.com/mcp",
      statusCode: 200,
      title: "MCP page",
      textContent: longBody,
      markdownContent: longBody,
      wordCount: 222,
      byteSize: longBody.length,
    });

    const compact = await callTool("get_page", { id: page.id });
    expect(JSON.stringify(compact)).not.toContain("textContent");
    expect(JSON.stringify(compact)).not.toContain("markdownContent");
    expect(JSON.stringify(compact)).not.toContain("TAIL_MARKER");
    expect(compact["hint"]).toContain("format");

    const full = await callTool("get_page", { id: page.id, format: "full" });
    expect(full["markdownContent"]).toContain("TAIL_MARKER");
  });

  it("keeps crawl_url compact by default and exposes full output explicitly", async () => {
    await createDbPath("mcp-crawl-url");
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        return new Response(
          `<html><head><title>Local page</title></head><body><main>${"content ".repeat(220)}TAIL_MARKER</main></body></html>`,
          { headers: { "content-type": "text/html" } },
        );
      },
    });
    servers.push(server);
    const url = `http://127.0.0.1:${server.port}/`;

    const compact = await callTool("crawl_url", { url, content_limit: 120 });
    expect(JSON.stringify(compact)).not.toContain("textContent");
    expect(JSON.stringify(compact)).not.toContain("TAIL_MARKER");
    expect(compact["hint"]).toContain("full");

    const full = await callTool("crawl_url", { url, full: true });
    expect(JSON.stringify(full)).toContain("textContent");
    expect(JSON.stringify(full)).toContain("TAIL_MARKER");
  });
});
