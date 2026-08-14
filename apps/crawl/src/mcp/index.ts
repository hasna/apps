#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createCrawl, getCrawl, listCrawls, getCrawlStats, deleteCrawl, getGlobalStats, updateCrawl } from "../db/crawls.js";
import { getPage, listPages, searchPages } from "../db/pages.js";
import {
  STORAGE_TABLES,
  getStorageStatus,
  storageArtifactsDownload,
  storageArtifactsUpload,
  storagePull,
  storagePush,
  storageSync,
} from "../db/storage-sync.js";
import { getConfig, setConfig } from "../lib/config.js";
import { fetchSitemap, type SitemapEntry } from "../lib/sitemap.js";
import type { ExportFormat } from "../types/index.js";
import { createWebhook, getWebhook, listWebhooks, deleteWebhook, listDeliveries } from "../db/webhooks.js";
import { VERSION } from "../version.js";
import {
  DEFAULT_PREVIEW_LIMIT,
  MCP_TEXT_PREVIEW_CHARS,
  compactCrawl,
  compactDelivery,
  compactPage,
  compactSearchResult,
  compactWebhook,
  compactWebSearchResult,
  parseLimit,
  truncateText,
} from "../lib/output.js";

// These modules exist at runtime but are not yet implemented.
// Using dynamic imports with .catch fallbacks so TypeScript infers `any` at call sites.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { startCrawl, crawlUrl, batchCrawl, recrawl } = await import("../lib/crawler.js").catch(() => ({
  startCrawl: null as any, crawlUrl: null as any, batchCrawl: null as any, recrawl: null as any,
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { extractWithAI, extractWithPrompt } = await import("../lib/ai.js").catch(() => ({ extractWithAI: null as any, extractWithPrompt: null as any }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { exportCrawl } = await import("../lib/export.js").catch(() => ({ exportCrawl: null as any }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { extractBranding } = await import("../lib/branding.js").catch(() => ({ extractBranding: null as any }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { searchWeb } = await import("../lib/search-web.js").catch(() => ({ searchWeb: null as any }));

// --- in-memory agent registry ---
interface _CrawlAgent { id: string; name: string; session_id?: string; last_seen_at: string; project_id?: string; }
const _crawlAgents = new Map<string, _CrawlAgent>();

function jsonText(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

function pageContent(page: { textContent: string | null; markdownContent: string | null }, format: "text" | "markdown") {
  return format === "text" ? page.textContent : page.markdownContent ?? page.textContent;
}

function compactUrlList(urls: string[], show: number, hint: string) {
  const visible = urls.slice(0, show);
  return {
    count: urls.length,
    shown: visible.length,
    urls: visible,
    truncated: urls.length > visible.length,
    hint: urls.length > visible.length ? hint : "Use the available filters or JSON/detail flags only if more detail is needed.",
  };
}

function parseOffset(value: number | undefined): number {
  if (!Number.isFinite(value) || !value || value < 0) return 0;
  return Math.floor(value);
}

// ─── Server Setup ────────────────────────────────────────────────────────────

export function buildServer(): McpServer {
const server = new McpServer({
  name: "open-crawl",
  version: VERSION,
});

const STORAGE_TABLE_SCHEMA = z.enum(STORAGE_TABLES);

// ─── Tool: crawl_url ─────────────────────────────────────────────────────────

server.tool(
  "crawl_url",
  "Crawl a single URL and return a compact page summary plus a truncated content preview by default",
  {
    url: z.string().describe("URL to crawl"),
    render: z.boolean().optional().describe("Use Playwright JS rendering"),
    screenshot: z.boolean().optional().describe("Capture a screenshot"),
    full: z.boolean().optional().describe("Return the full page record, including full text/markdown/html fields"),
    content_limit: z.number().optional().describe(`Preview character limit for compact output (default ${MCP_TEXT_PREVIEW_CHARS})`),
    extract_schema: z
      .string()
      .optional()
      .describe(
        'JSON schema string for AI-powered structured extraction, e.g. {"price": "number"}'
      ),
    actions: z
      .array(z.object({
        type: z.string(),
        selector: z.string().optional(),
        text: z.string().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        ms: z.number().optional(),
        timeout: z.number().optional(),
      }))
      .optional()
      .describe("Pre-scrape browser actions (click, type, scroll, wait, waitForSelector)"),
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ url, render, screenshot, full, content_limit, extract_schema, actions }: any) => {
    try {
      const extractSchema = extract_schema ? JSON.parse(extract_schema) : undefined;
      const crawl = createCrawl({
        url,
        depth: 1,
        maxPages: 1,
        options: {
          render,
          screenshot,
          actions,
          ...(extractSchema ? { extractSchema } : {}),
        },
      });
      updateCrawl(crawl.id, { status: "running" });

      let result;
      try {
        result = await crawlUrl(url, crawl.id, {
          render,
          screenshot,
          actions,
          ...(extractSchema ? { extractSchema } : {}),
        });
        updateCrawl(crawl.id, {
          status: "completed",
          pagesCrawled: 1,
          completedAt: new Date().toISOString(),
        });
      } catch (err) {
        updateCrawl(crawl.id, {
          status: "failed",
          errorMessage: (err as Error).message,
        });
        throw err;
      }

      if (full) {
        return jsonText({ crawl: compactCrawl(getCrawl(crawl.id) ?? crawl), page: result });
      }

      const previewChars = parseLimit(content_limit, MCP_TEXT_PREVIEW_CHARS, 20000);
      const content = pageContent(result, "markdown");
      const preview = truncateText(content, previewChars);

      return jsonText({
        crawlId: crawl.id,
        page: compactPage(result),
        linksCount: result.metadata?.links?.length ?? 0,
        screenshotPath: result.screenshotPath ?? null,
        preview: preview || null,
        truncated: (content?.replace(/\s+/g, " ").trim().length ?? 0) > preview.length,
        hint: "Use full: true for the complete page record, or content_limit to adjust preview length.",
      });
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
    actions: z
      .array(z.object({
        type: z.string(),
        selector: z.string().optional(),
        text: z.string().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        ms: z.number().optional(),
        timeout: z.number().optional(),
      }))
      .optional()
      .describe("Pre-scrape browser actions to run on each page"),
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ url, depth, max_pages, render, actions }: any) => {
    try {
      const result = (await startCrawl({
        url,
        depth,
        maxPages: max_pages,
        options: { render, actions },
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
    offset: z.number().optional().describe("Number of crawls to skip for pagination"),
  },
  ({ status, limit, offset }) => {
    try {
      const cappedLimit = parseLimit(limit, 20);
      const pageOffset = parseOffset(offset);
      const crawls = listCrawls({ status, limit: cappedLimit + 1, offset: pageOffset });
      const visible = crawls.slice(0, cappedLimit);
      const hasMore = crawls.length > visible.length;
      return jsonText({
        offset: pageOffset,
        count: visible.length,
        hasMore,
        nextOffset: hasMore ? pageOffset + visible.length : null,
        crawls: visible.map(compactCrawl),
        hint: hasMore
          ? "Use nextOffset as offset for more crawls, or filter by status; call get_crawl with an id for page summaries."
          : "Call get_crawl with an id for page summaries.",
      });
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
  "Get crawl details including stats and compact page summaries",
  {
    id: z.string().describe("Crawl ID"),
    limit: z.number().optional().describe("Maximum page summaries to return (default 20)"),
    offset: z.number().optional().describe("Number of page summaries to skip for pagination"),
    verbose: z.boolean().optional().describe("Include crawl options and full page metadata previews"),
  },
  ({ id, limit, offset, verbose }) => {
    try {
      const crawl = getCrawl(id);
      if (!crawl) {
        return {
          content: [{ type: "text" as const, text: `Crawl not found: ${id}` }],
          isError: true,
        };
      }

      const displayLimit = parseLimit(limit, 20);
      const pageOffset = parseOffset(offset);
      const stats = getCrawlStats(id);
      const pages = listPages(id, { limit: displayLimit + 1, offset: pageOffset });
      const visible = pages.slice(0, displayLimit);
      const hasMorePages = pages.length > visible.length;

      return jsonText({
        crawl: verbose ? crawl : compactCrawl(crawl),
        stats,
        offset: pageOffset,
        pageCount: visible.length,
        hasMorePages,
        nextOffset: hasMorePages ? pageOffset + visible.length : null,
        pages: visible.map((p) => compactPage(p, { includePreview: Boolean(verbose), previewChars: MCP_TEXT_PREVIEW_CHARS })),
        hint: hasMorePages
          ? "Use nextOffset as offset for more page summaries. Use get_page with format: \"full\" for a complete page record."
          : "Use get_page with format: \"full\" for a complete page record.",
      });
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
    include_content: z.boolean().optional().describe("Include a truncated text/markdown preview in the response (default true)"),
    content_limit: z.number().optional().describe(`Preview character limit (default ${MCP_TEXT_PREVIEW_CHARS})`),
  },
  ({ id, format, include_content, content_limit }) => {
    try {
      const page = getPage(id);
      if (!page) {
        return {
          content: [{ type: "text" as const, text: `Page not found: ${id}` }],
          isError: true,
        };
      }

      if (format === "full") {
        return jsonText(page);
      }

      const content = pageContent(page, format);
      const previewChars = parseLimit(content_limit, MCP_TEXT_PREVIEW_CHARS, 20000);
      const preview = include_content === false ? null : truncateText(content, previewChars) || null;

      return jsonText({
        page: compactPage(page),
        contentFormat: format,
        preview,
        truncated: preview ? (content?.replace(/\s+/g, " ").trim().length ?? 0) > preview.length : false,
        hint: "Use format: \"full\" for the complete page record, include_content: false for metadata only, or content_limit to adjust preview length.",
      });
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

      return jsonText({
        count: results.length,
        results: results.map(compactSearchResult),
        hint: "Use get_page with a pageId for preview/details, or format: \"full\" on get_page for complete content.",
      });
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
  "AI-powered structured data extraction from a URL using a JSON schema or free-text prompt",
  {
    url: z.string().describe("URL to extract data from"),
    schema: z
      .string()
      .optional()
      .describe(
        'JSON schema describing fields to extract, e.g. {"price": "number", "title": "string"}'
      ),
    prompt: z
      .string()
      .optional()
      .describe("Free-text prompt for extraction, e.g. 'What is the main product price?'"),
  },
  async ({ url, schema, prompt }) => {
    try {
      // First fetch the page text
      const { fetchPage } = await import("../lib/fetcher.js");
      const fetched = await fetchPage(url);
      const { extractContent } = await import("../lib/extractor.js");
      const extracted = extractContent(fetched.html, url);
      const text = extracted.text;

      if (prompt) {
        const answer = await extractWithPrompt(text, prompt);
        return {
          content: [{ type: "text" as const, text: answer }],
        };
      }

      if (!schema) {
        return {
          content: [{ type: "text" as const, text: "Error: either 'schema' or 'prompt' must be provided" }],
          isError: true,
        };
      }

      const parsedSchema = JSON.parse(schema);
      const result = (await extractWithAI(text, parsedSchema)) as unknown;

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

// ─── Tool: map_site ──────────────────────────────────────────────────────────

server.tool(
  "map_site",
  "Quickly discover all URLs on a website without crawling content. Uses sitemap + link extraction.",
  {
    url: z.string().describe("Website URL to map"),
    limit: z.number().optional().describe("Max URLs to discover (default: 1000)"),
    show: z.number().optional().describe(`Max URLs to include in the default response (default: ${DEFAULT_PREVIEW_LIMIT})`),
    all: z.boolean().optional().describe("Return every discovered URL"),
    search: z.string().optional().describe("Filter URLs containing this string"),
    allowSubdomains: z.boolean().optional(),
  },
  async ({ url, limit, show, all, search, allowSubdomains }) => {
    try {
      const { mapSite } = await import("../lib/crawler.js");
      const urls = await mapSite(url, { limit, search, allowSubdomains });
      return jsonText({
        ...compactUrlList(
          urls,
          all ? urls.length : parseLimit(show, DEFAULT_PREVIEW_LIMIT),
          "Set all: true, increase show, or use search to narrow the URL list."
        ),
        search: search ?? null,
      });
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

// ─── Tool: register_webhook ──────────────────────────────────────────────────

server.tool(
  "register_webhook",
  "Register a webhook endpoint to receive crawl events",
  {
    url: z.string().describe("The endpoint URL to send webhook events to"),
    events: z
      .array(z.string())
      .optional()
      .describe("Array of events to subscribe to (default: [\"crawl.completed\"])"),
    secret: z
      .string()
      .optional()
      .describe("HMAC secret for request signing (X-Crawl-Signature header)"),
  },
  ({ url, events, secret }) => {
    try {
      const webhook = createWebhook({
        url,
        events: events as Parameters<typeof createWebhook>[0]["events"],
        secret,
      });
      return jsonText({
        webhook: compactWebhook(webhook),
        hint: "Secret values are not returned. Use list_webhooks for compact summaries.",
      });
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: list_webhooks ─────────────────────────────────────────────────────

server.tool(
  "list_webhooks",
  "List all registered webhook endpoints",
  {
    limit: z.number().optional().describe("Maximum webhooks to return (default 20)"),
    offset: z.number().optional().describe("Number of webhooks to skip for pagination"),
  },
  ({ limit, offset }) => {
    try {
      const displayLimit = parseLimit(limit, 20);
      const pageOffset = parseOffset(offset);
      const webhooks = listWebhooks();
      const visible = webhooks.slice(pageOffset, pageOffset + displayLimit);
      const hasMore = webhooks.length > pageOffset + visible.length;
      return jsonText({
        offset: pageOffset,
        count: visible.length,
        hasMore,
        nextOffset: hasMore ? pageOffset + visible.length : null,
        webhooks: visible.map(compactWebhook),
        hint: hasMore
          ? "Use nextOffset as offset for more webhook summaries. Secrets are omitted by default."
          : "Secrets are omitted by default.",
      });
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: delete_webhook ─────────────────────────────────────────────────────

server.tool(
  "delete_webhook",
  "Delete a registered webhook endpoint",
  {
    id: z.string().describe("Webhook ID to delete"),
  },
  ({ id }) => {
    try {
      const webhook = getWebhook(id);
      if (!webhook) {
        return {
          content: [{ type: "text" as const, text: `Webhook not found: ${id}` }],
          isError: true,
        };
      }
      const deleted = deleteWebhook(id);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ deleted, id, url: webhook.url }, null, 2),
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

// ─── Tool: get_webhook_deliveries ─────────────────────────────────────────────

server.tool(
  "get_webhook_deliveries",
  "Get delivery history for a webhook endpoint",
  {
    id: z.string().describe("Webhook ID"),
    limit: z.number().optional().describe("Maximum number of deliveries to return (default 20)"),
    offset: z.number().optional().describe("Number of deliveries to skip for pagination"),
    include_payloads: z.boolean().optional().describe("Include truncated payload/response previews"),
  },
  ({ id, limit, offset, include_payloads }) => {
    try {
      const webhook = getWebhook(id);
      if (!webhook) {
        return {
          content: [{ type: "text" as const, text: `Webhook not found: ${id}` }],
          isError: true,
        };
      }
      const displayLimit = parseLimit(limit, 20);
      const pageOffset = parseOffset(offset);
      const deliveries = listDeliveries(id, displayLimit + 1, pageOffset);
      const visible = deliveries.slice(0, displayLimit);
      const hasMore = deliveries.length > visible.length;
      return jsonText({
        offset: pageOffset,
        count: visible.length,
        hasMore,
        nextOffset: hasMore ? pageOffset + visible.length : null,
        webhook: compactWebhook(webhook),
        deliveries: visible.map((d) => compactDelivery(d, { verbose: include_payloads })),
        hint: hasMore
          ? "Use nextOffset as offset for older deliveries. Set include_payloads: true for truncated payload/response previews."
          : "Set include_payloads: true for truncated payload/response previews.",
      });
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: extract_branding ──────────────────────────────────────────────────

server.tool(
  "extract_branding",
  "Extract branding information (logo, favicon, colors, fonts, theme color) from a webpage",
  {
    url: z.string().describe("URL to extract branding from"),
  },
  async ({ url }) => {
    try {
      const { fetchPage } = await import("../lib/fetcher.js");
      const fetched = await fetchPage(url);
      const branding = extractBranding(fetched.html, url);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(branding, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: search_web ────────────────────────────────────────────────────────

server.tool(
  "search_web",
  "Search the web using Exa and return results (requires EXA_API_KEY)",
  {
    query: z.string().describe("Search query"),
    limit: z.number().optional().describe("Number of results to return (default 10)"),
    scrape: z.boolean().optional().describe("Also crawl and store each result URL"),
    verbose: z.boolean().optional().describe("Include scraped page previews when scrape is true"),
  },
  async ({ query, limit, scrape, verbose }) => {
    try {
      const results = await searchWeb(query, { limit, scrape });
      return jsonText({
        count: results.length,
        results: results.map((r: any) => compactWebSearchResult(r, { includePage: verbose })),
        hint: scrape
          ? "Set verbose: true for scraped page previews, or use get_page on the scraped page id for details."
          : "Set scrape: true to crawl result URLs.",
      });
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ─── Sandbox tools ───────────────────────────────────────────────────────────

server.tool(
  "crawl_in_sandbox",
  "Crawl a URL inside an isolated e2b cloud sandbox. Useful for avoiding IP blocks and crawling in a clean environment. Requires E2B_API_KEY.",
  {
    url: z.string().describe("URL to crawl"),
    depth: z.number().optional().describe("Crawl depth (default: 1)"),
    maxPages: z.number().optional().describe("Max pages to crawl (default: 50)"),
    timeoutMs: z.number().optional().describe("Sandbox timeout in ms (default: 300000)"),
  },
  async ({ url, depth, maxPages, timeoutMs }) => {
    try {
      const { crawlInSandbox, checkE2B } = await import("../lib/sandbox.js");
      const status = checkE2B();
      if (!status.available) {
        return { content: [{ type: "text" as const, text: `Cannot use sandbox: ${status.reason}. Set E2B_API_KEY.` }], isError: true };
      }
      const result = await crawlInSandbox({ url, depth, maxPages }, { timeoutMs });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            crawlId: result.crawl.id,
            sandboxId: result.sandboxId,
            pagesCrawled: result.pages.length,
            durationMs: result.durationMs,
            pages: result.pages.slice(0, 5).map(p => ({ url: p.url, title: p.title, wordCount: p.wordCount })),
          }, null, 2),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: String(err) }], isError: true };
    }
  }
);

server.tool(
  "map_in_sandbox",
  "Discover all URLs on a site using an e2b cloud sandbox. Requires E2B_API_KEY.",
  {
    url: z.string().describe("Website URL to map"),
    limit: z.number().optional().describe("Max URLs to discover (default: 1000)"),
    show: z.number().optional().describe(`Max URLs to include in the default response (default: ${DEFAULT_PREVIEW_LIMIT})`),
    all: z.boolean().optional().describe("Return every discovered URL"),
    search: z.string().optional().describe("Filter URLs containing this string"),
  },
  async ({ url, limit, show, all, search }) => {
    try {
      const { mapInSandbox, checkE2B } = await import("../lib/sandbox.js");
      const status = checkE2B();
      if (!status.available) {
        return { content: [{ type: "text" as const, text: `Cannot use sandbox: ${status.reason}` }], isError: true };
      }
      const urls = await mapInSandbox(url, { limit, search });
      return jsonText({
        ...compactUrlList(
          urls,
          all ? urls.length : parseLimit(show, DEFAULT_PREVIEW_LIMIT),
          "Set all: true, increase show, or use search to narrow the URL list."
        ),
        search: search ?? null,
      });
    } catch (err) {
      return { content: [{ type: "text" as const, text: String(err) }], isError: true };
    }
  }
);

server.tool(
  "check_sandbox",
  "Check if e2b sandbox is configured and available.",
  {},
  async () => {
    const { checkE2B } = await import("../lib/sandbox.js");
    const status = checkE2B();
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          available: status.available,
          reason: status.reason ?? null,
          setup: status.available ? "Ready" : "Set E2B_API_KEY env var. Get a key at https://e2b.dev",
        }, null, 2),
      }],
    };
  }
);

// ─── Tool: send_feedback ────────────────────────────────────────────────────

server.tool(
  "send_feedback",
  "Send feedback about this service",
  {
    message: z.string().describe("Feedback message"),
    email: z.string().optional().describe("Contact email (optional)"),
    category: z.enum(["bug", "feature", "general"]).optional().describe("Feedback category"),
  },
  async (params) => {
    const { getDb } = await import("../db/database.js");
    const db = getDb();
    db.run(
      "INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)",
      [params.message, params.email || null, params.category || "general", VERSION]
    );
    return { content: [{ type: "text" as const, text: "Feedback saved. Thank you!" }] };
  }
);

// ─── Tool: storage_status ───────────────────────────────────────────────────

server.tool(
  "storage_status",
  "Show open-crawl remote storage configuration and local sync metadata",
  {},
  async () => ({
    content: [{
      type: "text" as const,
      text: JSON.stringify(getStorageStatus(), null, 2),
    }],
  })
);

server.tool(
  "storage_push",
  "Push local open-crawl tables to the configured remote Postgres storage",
  { tables: z.array(STORAGE_TABLE_SCHEMA).optional().describe("Tables to push") },
  async ({ tables }) => ({
    content: [{ type: "text" as const, text: JSON.stringify(await storagePush({ tables }), null, 2) }],
  })
);

server.tool(
  "storage_pull",
  "Pull open-crawl tables from the configured remote Postgres storage",
  { tables: z.array(STORAGE_TABLE_SCHEMA).optional().describe("Tables to pull") },
  async ({ tables }) => ({
    content: [{ type: "text" as const, text: JSON.stringify(await storagePull({ tables }), null, 2) }],
  })
);

server.tool(
  "storage_sync",
  "Push then pull open-crawl tables with the configured remote Postgres storage",
  { tables: z.array(STORAGE_TABLE_SCHEMA).optional().describe("Tables to sync") },
  async ({ tables }) => ({
    content: [{ type: "text" as const, text: JSON.stringify(await storageSync({ tables }), null, 2) }],
  })
);

server.tool(
  "storage_artifacts_upload",
  "Upload local open-crawl screenshot artifacts to configured S3 storage",
  {
    crawl_id: z.string().optional().describe("Limit uploads to one crawl"),
    page_id: z.string().optional().describe("Limit uploads to one page screenshot"),
  },
  async ({ crawl_id, page_id }) => ({
    content: [{
      type: "text" as const,
      text: JSON.stringify(await storageArtifactsUpload({ crawlId: crawl_id, pageId: page_id }), null, 2),
    }],
  })
);

server.tool(
  "storage_artifacts_download",
  "Download open-crawl screenshot artifacts from configured S3 storage",
  {
    crawl_id: z.string().optional().describe("Limit downloads to one crawl"),
    page_id: z.string().optional().describe("Limit downloads to one page screenshot"),
  },
  async ({ crawl_id, page_id }) => ({
    content: [{
      type: "text" as const,
      text: JSON.stringify(await storageArtifactsDownload({ crawlId: crawl_id, pageId: page_id }), null, 2),
    }],
  })
);

// ─── Agent Tools ─────────────────────────────────────────────────────────────

server.tool("register_agent", "Register an agent session. Returns agent_id. Auto-triggers a heartbeat.", {
  name: z.string(),
  session_id: z.string().optional(),
}, async (params) => {
  const existing = [..._crawlAgents.values()].find(a => a.name === params.name);
  if (existing) { existing.last_seen_at = new Date().toISOString(); if (params.session_id) existing.session_id = params.session_id; return { content: [{ type: "text" as const, text: JSON.stringify(existing) }] }; }
  const id = Math.random().toString(36).slice(2, 10);
  const ag: _CrawlAgent = { id, name: params.name, session_id: params.session_id, last_seen_at: new Date().toISOString() };
  _crawlAgents.set(id, ag);
  return { content: [{ type: "text" as const, text: JSON.stringify(ag) }] };
});

server.tool("heartbeat", "Update last_seen_at to signal agent is active.", {
  agent_id: z.string(),
}, async (params) => {
  const ag = _crawlAgents.get(params.agent_id);
  if (!ag) return { content: [{ type: "text" as const, text: `Agent not found: ${params.agent_id}` }], isError: true };
  ag.last_seen_at = new Date().toISOString();
  return { content: [{ type: "text" as const, text: JSON.stringify({ agent_id: ag.id, last_seen_at: ag.last_seen_at }) }] };
});

server.tool("set_focus", "Set active project context for this agent session.", {
  agent_id: z.string(),
  project_id: z.string().optional(),
}, async (params) => {
  const ag = _crawlAgents.get(params.agent_id);
  if (!ag) return { content: [{ type: "text" as const, text: `Agent not found: ${params.agent_id}` }], isError: true };
  ag.project_id = params.project_id;
  return { content: [{ type: "text" as const, text: JSON.stringify({ agent_id: ag.id, project_id: ag.project_id ?? null }) }] };
});

server.tool("list_agents", "List all registered agents.", {}, async () => {
  return { content: [{ type: "text" as const, text: JSON.stringify([..._crawlAgents.values()]) }] };
});

return server;
}

// ─── Start ───────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  const { isStdioMode } = await import("./http.js");
  if (isStdioMode(argv)) {
    const transport = new StdioServerTransport();
    await buildServer().connect(transport);
    return;
  }
  // Default: shared Streamable HTTP server (one process per MCP, many agents).
  const { resolveMcpHttpPort } = await import("./http.js");
  const { startCrawlServer } = await import("../server/index.js");
  const port = resolveMcpHttpPort(argv);
  await startCrawlServer({ port, hostname: "127.0.0.1" });
  await new Promise(() => {});
}

if (import.meta.main) {
  main().catch((err) => {
    process.stderr.write(`Fatal: ${(err as Error).message}\n`);
    process.exit(1);
  });
}
