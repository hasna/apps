#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getCrawl, listCrawls, getCrawlStats, deleteCrawl, getGlobalStats } from "../db/crawls.js";
import { getPage, listPages, searchPages } from "../db/pages.js";
import { getConfig, setConfig } from "../lib/config.js";
import { fetchSitemap, type SitemapEntry } from "../lib/sitemap.js";
import type { ExportFormat } from "../types/index.js";

// These modules exist at runtime but are not yet implemented.
// Using dynamic imports with .catch fallbacks so TypeScript infers `any` at call sites.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { startCrawl, crawlUrl, batchCrawl, recrawl } = await import("../lib/crawler.js").catch(() => ({
  startCrawl: null as any, crawlUrl: null as any, batchCrawl: null as any, recrawl: null as any,
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { extractWithAI } = await import("../lib/ai.js").catch(() => ({ extractWithAI: null as any }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { exportCrawl } = await import("../lib/export.js").catch(() => ({ exportCrawl: null as any }));

// ─── Server Setup ────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "open-crawl",
  version: "0.1.0",
});

// ─── Tool: crawl_url ─────────────────────────────────────────────────────────

server.tool(
  "crawl_url",
  "Crawl a single URL and return its content (title, text, markdown, metadata, links, word count)",
  {
    url: z.string().describe("URL to crawl"),
    render: z.boolean().optional().describe("Use Playwright JS rendering"),
    screenshot: z.boolean().optional().describe("Capture a screenshot"),
    extract_schema: z
      .string()
      .optional()
      .describe(
        'JSON schema string for AI-powered structured extraction, e.g. {"price": "number"}'
      ),
  },
  async ({ url, render, screenshot, extract_schema }) => {
    try {
      const extractSchema = extract_schema ? JSON.parse(extract_schema) : undefined;
      // crawlUrl returns a Page-like object from the runtime crawler module
      const result = (await crawlUrl(url, {
        render,
        screenshot,
        extractSchema,
      })) as {
        url: string;
        title: string | null;
        statusCode: number | null;
        wordCount: number | null;
        textContent: string | null;
        markdownContent: string | null;
        description: string | null;
        metadata: { links?: unknown[] };
        screenshotPath: string | null;
        extractedData?: unknown;
      };

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                url: result.url,
                title: result.title,
                statusCode: result.statusCode,
                wordCount: result.wordCount,
                linksCount: result.metadata?.links?.length ?? 0,
                markdown: result.markdownContent,
                text: result.textContent,
                description: result.description,
                metadata: result.metadata,
                screenshotPath: result.screenshotPath ?? null,
                extractedData: result.extractedData ?? null,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: crawl_site ────────────────────────────────────────────────────────

server.tool(
  "crawl_site",
  "Recursively crawl a site up to a specified depth and page count",
  {
    url: z.string().describe("Starting URL to crawl"),
    depth: z.number().default(2).describe("Crawl depth (default 2)"),
    max_pages: z.number().default(50).describe("Maximum pages to crawl (default 50)"),
    render: z.boolean().optional().describe("Use Playwright JS rendering"),
  },
  async ({ url, depth, max_pages, render }) => {
    try {
      const result = (await startCrawl(url, {
        depth,
        maxPages: max_pages,
        render,
      })) as { id: string; status: string; pagesCrawled: number };

      const crawl = getCrawl(result.id);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                crawlId: result.id,
                url,
                status: crawl?.status ?? result.status,
                pagesCrawled: crawl?.pagesCrawled ?? result.pagesCrawled,
                depth,
                maxPages: max_pages,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: crawl_sitemap ─────────────────────────────────────────────────────

server.tool(
  "crawl_sitemap",
  "Discover URLs from a sitemap.xml and crawl them",
  {
    url: z.string().describe("Base URL or direct URL to sitemap.xml"),
    max_pages: z.number().default(100).describe("Maximum pages to crawl (default 100)"),
  },
  async ({ url, max_pages }) => {
    try {
      const entries: SitemapEntry[] = await fetchSitemap(url);
      const urlsToProcess = entries.slice(0, max_pages).map((e) => e.url);

      const results = (await batchCrawl(urlsToProcess, {})) as Array<{
        id?: string;
        url: string;
        status: string;
      }>;

      const crawlIds = results.filter((r) => r.id).map((r) => r.id as string);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                sitemapUrl: url,
                discoveredUrls: entries.length,
                crawledUrls: urlsToProcess.length,
                crawlIds,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: list_crawls ───────────────────────────────────────────────────────

server.tool(
  "list_crawls",
  "List crawl jobs, optionally filtered by status",
  {
    status: z
      .string()
      .optional()
      .describe("Filter by status: pending | running | completed | failed"),
    limit: z.number().default(20).describe("Maximum number of crawls to return (default 20)"),
  },
  ({ status, limit }) => {
    try {
      const crawls = listCrawls({ status, limit });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              crawls.map((c) => ({
                id: c.id,
                url: c.url,
                domain: c.domain,
                status: c.status,
                pagesCrawled: c.pagesCrawled,
                maxPages: c.maxPages,
                depth: c.depth,
                createdAt: c.createdAt,
                completedAt: c.completedAt,
              })),
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: get_crawl ─────────────────────────────────────────────────────────

server.tool(
  "get_crawl",
  "Get crawl details including stats and the first 20 pages",
  {
    id: z.string().describe("Crawl ID"),
  },
  ({ id }) => {
    try {
      const crawl = getCrawl(id);
      if (!crawl) {
        return {
          content: [{ type: "text" as const, text: `Crawl not found: ${id}` }],
          isError: true,
        };
      }

      const stats = getCrawlStats(id);
      const pages = listPages(id, { limit: 20 });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                crawl,
                stats,
                pages: pages.map((p) => ({
                  id: p.id,
                  url: p.url,
                  title: p.title,
                  statusCode: p.statusCode,
                  wordCount: p.wordCount,
                  crawledAt: p.crawledAt,
                })),
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: get_page ──────────────────────────────────────────────────────────

server.tool(
  "get_page",
  "Get the content of a single crawled page",
  {
    id: z.string().describe("Page ID"),
    format: z
      .enum(["text", "markdown", "full"])
      .default("markdown")
      .describe("Content format: text | markdown | full (default markdown)"),
  },
  ({ id, format }) => {
    try {
      const page = getPage(id);
      if (!page) {
        return {
          content: [{ type: "text" as const, text: `Page not found: ${id}` }],
          isError: true,
        };
      }

      if (format === "full") {
        return {
          content: [{ type: "text" as const, text: JSON.stringify(page, null, 2) }],
        };
      }

      const content =
        format === "text"
          ? page.textContent
          : page.markdownContent ?? page.textContent;

      const header = [
        `# ${page.title ?? "(no title)"}`,
        `URL: ${page.url}`,
        `Status: ${page.statusCode ?? "unknown"}`,
        `Words: ${page.wordCount ?? 0}`,
        `Crawled: ${page.crawledAt}`,
        "",
      ].join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: header + (content ?? "(no content)"),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: search_pages ──────────────────────────────────────────────────────

server.tool(
  "search_pages",
  "Full-text search across all crawled pages",
  {
    query: z.string().describe("Search query"),
    domain: z.string().optional().describe("Filter results to a specific domain"),
    crawl_id: z.string().optional().describe("Filter results to a specific crawl"),
    limit: z.number().default(10).describe("Maximum number of results (default 10)"),
  },
  ({ query, domain, crawl_id, limit }) => {
    try {
      const results = searchPages(query, {
        domain,
        crawlId: crawl_id,
        limit,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              results.map((r) => ({
                pageId: r.page.id,
                url: r.page.url,
                title: r.page.title,
                snippet: r.snippet,
                rank: r.rank,
                wordCount: r.page.wordCount,
                crawlId: r.page.crawlId,
              })),
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: export_pages ──────────────────────────────────────────────────────

server.tool(
  "export_pages",
  "Export all pages from a crawl as JSON, Markdown, or CSV",
  {
    crawl_id: z.string().describe("Crawl ID to export"),
    format: z
      .enum(["json", "md", "csv"])
      .describe("Export format: json | md | csv"),
  },
  async ({ crawl_id, format }) => {
    try {
      const crawl = getCrawl(crawl_id);
      if (!crawl) {
        return {
          content: [{ type: "text" as const, text: `Crawl not found: ${crawl_id}` }],
          isError: true,
        };
      }

      const content: unknown = await exportCrawl(crawl_id, format as ExportFormat);
      const output =
        typeof content === "string" ? content : JSON.stringify(content, null, 2);

      return {
        content: [{ type: "text" as const, text: output }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: extract_data ──────────────────────────────────────────────────────

server.tool(
  "extract_data",
  "AI-powered structured data extraction from a URL using a JSON schema",
  {
    url: z.string().describe("URL to extract data from"),
    schema: z
      .string()
      .describe(
        'JSON schema describing fields to extract, e.g. {"price": "number", "title": "string"}'
      ),
  },
  async ({ url, schema }) => {
    try {
      const parsedSchema = JSON.parse(schema);
      const result = (await extractWithAI(url, parsedSchema)) as unknown;

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: recrawl ───────────────────────────────────────────────────────────

server.tool(
  "recrawl",
  "Re-crawl all pages in a crawl job and detect content changes",
  {
    crawl_id: z.string().describe("Crawl ID to re-crawl"),
  },
  async ({ crawl_id }) => {
    try {
      const crawl = getCrawl(crawl_id);
      if (!crawl) {
        return {
          content: [
            { type: "text" as const, text: `Crawl not found: ${crawl_id}` },
          ],
          isError: true,
        };
      }

      const result = (await recrawl(crawl_id)) as {
        pagesCrawled: number;
        changesDetected: number;
      };

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                crawlId: crawl_id,
                pagesCrawled: result.pagesCrawled,
                changesDetected: result.changesDetected,
                status: "completed",
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: get_config ────────────────────────────────────────────────────────

server.tool(
  "get_config",
  "Get the current open-crawl configuration",
  {},
  () => {
    try {
      const config = getConfig();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(config, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: set_config ────────────────────────────────────────────────────────

server.tool(
  "set_config",
  "Update a configuration value",
  {
    key: z
      .string()
      .describe("Config key to set (e.g. defaultDelay, maxPages, aiProvider)"),
    value: z
      .string()
      .describe(
        "Value to set (will be parsed as JSON if possible, otherwise treated as string)"
      ),
  },
  ({ key, value }) => {
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        parsed = value;
      }

      const updates = { [key]: parsed } as Parameters<typeof setConfig>[0];
      const updated = setConfig(updates);
      const displayVal = updated[key as keyof typeof updated];

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                key,
                value: displayVal,
                config: updated,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: delete_crawl ──────────────────────────────────────────────────────

server.tool(
  "delete_crawl",
  "Delete a crawl job and all its pages",
  { id: z.string().describe("Crawl ID to delete") },
  async ({ id }) => {
    try {
      const crawl = getCrawl(id);
      if (!crawl) return { content: [{ type: "text" as const, text: `Crawl not found: ${id}` }], isError: true };
      const stats = getCrawlStats(id);
      deleteCrawl(id);
      return { content: [{ type: "text" as const, text: `Deleted crawl ${id} and ${stats.total} pages` }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: String(err) }], isError: true };
    }
  }
);

// ─── Tool: get_stats ─────────────────────────────────────────────────────────

server.tool(
  "get_stats",
  "Get global stats: total crawls, pages, words, top domains, DB size",
  {},
  async () => {
    try {
      const stats = getGlobalStats();
      return { content: [{ type: "text" as const, text: JSON.stringify(stats, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: String(err) }], isError: true };
    }
  }
);

// ─── Tool: resume_crawl ──────────────────────────────────────────────────────

server.tool(
  "resume_crawl",
  "Resume an interrupted crawl, skipping already-crawled pages",
  { id: z.string().describe("Crawl ID to resume") },
  async ({ id }) => {
    try {
      const { resumeCrawl } = await import("../lib/crawler.js");
      const result = await resumeCrawl(id);
      return { content: [{ type: "text" as const, text: JSON.stringify({ id: result.id, status: result.status, pagesCrawled: result.pagesCrawled }, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: String(err) }], isError: true };
    }
  }
);

// ─── Start ───────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
