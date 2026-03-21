#!/usr/bin/env bun
import { listCrawls, getCrawl, createCrawl } from "../db/crawls.js";
import { listPages, getPage, searchPages } from "../db/pages.js";
import { getConfig } from "../lib/config.js";
import { createWebhook, getWebhook, listWebhooks, deleteWebhook, listDeliveries, createDelivery } from "../db/webhooks.js";
import { deliverWebhook, retryFailedDeliveries } from "../lib/webhooks.js";
import { validateApiKey, extractBearerToken } from "../lib/api-auth.js";
import { createApiKey, listApiKeys, revokeApiKey } from "../db/api-keys.js";
import { getUsageSummary, getRecentEvents } from "../db/usage.js";
import type { ApiKey } from "../types/index.js";

const PORT = parseInt(process.env.PORT ?? "19700", 10);

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>open-crawl dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f0f0f; color: #e0e0e0; min-height: 100vh; }
    header { background: #1a1a1a; border-bottom: 1px solid #333; padding: 16px 24px; display: flex; align-items: center; gap: 12px; }
    header h1 { font-size: 18px; font-weight: 600; color: #fff; }
    header span { background: #22c55e; color: #000; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; }
    main { padding: 24px; max-width: 1200px; margin: 0 auto; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 32px; }
    .stat { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 20px; }
    .stat h3 { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
    .stat p { font-size: 28px; font-weight: 700; color: #fff; }
    .section { margin-bottom: 32px; }
    .section h2 { font-size: 16px; font-weight: 600; margin-bottom: 16px; color: #ccc; }
    table { width: 100%; border-collapse: collapse; background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; overflow: hidden; }
    th { background: #111; padding: 12px 16px; text-align: left; font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 0.05em; }
    td { padding: 12px 16px; border-top: 1px solid #2a2a2a; font-size: 13px; }
    tr:hover td { background: #222; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .badge.completed { background: #14532d; color: #4ade80; }
    .badge.running { background: #1e3a5f; color: #60a5fa; }
    .badge.failed { background: #450a0a; color: #f87171; }
    .badge.pending { background: #2a2a00; color: #facc15; }
    a { color: #60a5fa; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .search { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 24px; margin-bottom: 32px; }
    .search input { width: 100%; background: #111; border: 1px solid #333; border-radius: 6px; padding: 10px 14px; color: #fff; font-size: 14px; outline: none; }
    .search input:focus { border-color: #60a5fa; }
    #results { margin-top: 16px; }
    .result { padding: 12px; border-bottom: 1px solid #2a2a2a; }
    .result:last-child { border-bottom: none; }
    .result a { font-weight: 600; }
    .result p { font-size: 12px; color: #888; margin-top: 4px; }
    mark { background: #422006; color: #fb923c; border-radius: 2px; padding: 0 2px; }
  </style>
</head>
<body>
  <header>
    <h1>open-crawl</h1>
    <span>dashboard</span>
  </header>
  <main>
    <div class="stats" id="stats">Loading...</div>
    <div class="search">
      <input type="search" id="q" placeholder="Search crawled pages..." oninput="debounceSearch()">
      <div id="results"></div>
    </div>
    <div class="section">
      <h2>Recent Crawls</h2>
      <table id="crawls-table">
        <thead><tr><th>URL</th><th>Status</th><th>Pages</th><th>Depth</th><th>Created</th></tr></thead>
        <tbody id="crawls-body">Loading...</tbody>
      </table>
    </div>
  </main>
  <script>
    async function load() {
      const [crawls] = await Promise.all([fetch('/v1/crawls').then(r => r.json())]);
      const completed = crawls.filter(c => c.status === 'completed').length;
      const running = crawls.filter(c => c.status === 'running').length;
      const totalPages = crawls.reduce((s, c) => s + (c.pagesCrawled || 0), 0);
      document.getElementById('stats').innerHTML = \`
        <div class="stat"><h3>Total Crawls</h3><p>\${crawls.length}</p></div>
        <div class="stat"><h3>Completed</h3><p>\${completed}</p></div>
        <div class="stat"><h3>Running</h3><p>\${running}</p></div>
        <div class="stat"><h3>Pages Crawled</h3><p>\${totalPages.toLocaleString()}</p></div>
      \`;
      document.getElementById('crawls-body').innerHTML = crawls.slice(0, 50).map(c => \`
        <tr>
          <td><a href="/v1/crawls/\${c.id}">\${c.url}</a></td>
          <td><span class="badge \${c.status}">\${c.status}</span></td>
          <td>\${c.pagesCrawled ?? 0}</td>
          <td>\${c.depth}</td>
          <td>\${new Date(c.createdAt).toLocaleString()}</td>
        </tr>
      \`).join('') || '<tr><td colspan="5" style="color:#666;text-align:center;padding:32px">No crawls yet. Run: crawl &lt;url&gt;</td></tr>';
    }
    let timer;
    function debounceSearch() { clearTimeout(timer); timer = setTimeout(doSearch, 300); }
    async function doSearch() {
      const q = document.getElementById('q').value.trim();
      if (!q) { document.getElementById('results').innerHTML = ''; return; }
      const data = await fetch(\`/v1/search?q=\${encodeURIComponent(q)}&limit=10\`).then(r => r.json());
      document.getElementById('results').innerHTML = data.map(r => \`
        <div class="result">
          <a href="/v1/pages/\${r.page.id}">\${r.page.title || r.page.url}</a>
          <p>\${r.page.url}</p>
          <p>\${r.snippet}</p>
        </div>
      \`).join('') || '<p style="color:#666;padding:8px">No results.</p>';
    }
    load();
  </script>
</body>
</html>`;

// ─── In-memory sliding window rate limiter ────────────────────────────────────

const rateLimitWindows = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(key: string, limitPerMinute: number): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const window = rateLimitWindows.get(key) ?? { count: 0, windowStart: now };

  // Reset window if expired
  if (now - window.windowStart > 60_000) {
    window.count = 0;
    window.windowStart = now;
  }

  window.count++;
  rateLimitWindows.set(key, window);

  const resetAt = window.windowStart + 60_000;
  const remaining = Math.max(0, limitPerMinute - window.count);
  return { allowed: window.count <= limitPerMinute, remaining, resetAt };
}

// ─── Response helpers ─────────────────────────────────────────────────────────

function json(data: unknown, status = 200, extraHeaders?: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-API-Version": "1",
      ...extraHeaders,
    },
  });
}

function notFound(msg = "Not found") {
  return json({ error: msg }, 404);
}

function badRequest(msg: string) {
  return json({ error: msg }, 400);
}

function checkAuth(req: Request): { apiKey: ApiKey | null; unauthorized: boolean } {
  const config = getConfig();
  if (!config.requireAuth) return { apiKey: null, unauthorized: false };
  const token = extractBearerToken(req);
  if (!token) return { apiKey: null, unauthorized: true };
  const key = validateApiKey(token);
  if (!key) return { apiKey: null, unauthorized: true };
  return { apiKey: key, unauthorized: false };
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const rawPath = url.pathname;
    const method = req.method;

    // Dashboard — serve on /dashboard
    if (rawPath === "/dashboard") {
      return new Response(DASHBOARD_HTML, {
        headers: { "Content-Type": "text/html" },
      });
    }

    // Root — JSON info endpoint or dashboard redirect
    if (rawPath === "/") {
      const acceptHeader = req.headers.get("accept") ?? "";
      if (acceptHeader.includes("application/json")) {
        return json({
          name: "open-crawl",
          version: "0.2.0",
          apiVersion: "v1",
          port: PORT,
        });
      }
      return new Response(DASHBOARD_HTML, {
        headers: { "Content-Type": "text/html" },
      });
    }

    // Normalize path: /v1/* is the canonical form, /api/* is an alias
    const path = rawPath.startsWith("/v1/") ? rawPath : rawPath.replace(/^\/api\//, "/v1/");

    // Auth enforcement on API routes
    if (path.startsWith("/v1/")) {
      const { apiKey, unauthorized } = checkAuth(req);
      if (unauthorized) return json({ error: "Unauthorized. Provide a valid API key in Authorization: Bearer <key>" }, 401);

      // Rate limiting — applied after auth
      const config = getConfig();
      const rlLimit = config.rateLimit ?? 60;
      const rlKey = apiKey?.id ?? req.headers.get("x-forwarded-for") ?? "anonymous";
      const rl = checkRateLimit(rlKey, rlLimit);

      if (!rl.allowed) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
            "X-RateLimit-Limit": String(rlLimit),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(Math.ceil(rl.resetAt / 1000)),
            "X-API-Version": "1",
          },
        });
      }
    }

    // POST /v1/keys — create API key
    if (path === "/v1/keys" && method === "POST") {
      try {
        const body = await req.json() as { name?: string; expiresAt?: string };
        const { apiKey, rawKey } = createApiKey({ name: body.name, expiresAt: body.expiresAt });
        return json({ key: rawKey, id: apiKey.id, prefix: apiKey.keyPrefix }, 201);
      } catch (err) {
        return json({ error: String(err) }, 500);
      }
    }

    // GET /v1/keys — list API keys
    if (path === "/v1/keys" && method === "GET") {
      const keys = listApiKeys().map(({ keyHash: _kh, ...rest }) => rest);
      return json(keys);
    }

    // DELETE /v1/keys/:id — revoke API key
    const keyDeleteMatch = path.match(/^\/v1\/keys\/([^/]+)$/);
    if (keyDeleteMatch && method === "DELETE") {
      const revoked = revokeApiKey(keyDeleteMatch[1] as string);
      if (!revoked) return notFound("API key not found");
      return json({ revoked: true });
    }

    // GET /v1/usage — usage summary
    if (path === "/v1/usage" && method === "GET") {
      const apiKeyId = url.searchParams.get("api_key_id") ?? undefined;
      const sinceParam = url.searchParams.get("since");
      const since = sinceParam ? new Date(sinceParam) : undefined;
      return json(getUsageSummary({ apiKeyId, since }));
    }

    // GET /v1/usage/events — recent usage events
    if (path === "/v1/usage/events" && method === "GET") {
      const apiKeyId = url.searchParams.get("api_key_id") ?? undefined;
      const limit = parseInt(url.searchParams.get("limit") ?? "50");
      return json(getRecentEvents({ apiKeyId, limit }));
    }

    // GET /v1/crawls — list crawls
    if (path === "/v1/crawls" && method === "GET") {
      const status = url.searchParams.get("status") ?? undefined;
      const limit = parseInt(url.searchParams.get("limit") ?? "50");
      const offset = parseInt(url.searchParams.get("offset") ?? "0");
      return json(listCrawls({ status, limit, offset }));
    }

    // POST /v1/crawls — start a crawl (sync or async)
    if (path === "/v1/crawls" && method === "POST") {
      try {
        const body = await req.json() as { url?: string; depth?: number; maxPages?: number; async?: boolean };
        if (!body.url) return badRequest("url is required");

        const { startCrawl } = await import("../lib/crawler.js");

        if (body.async) {
          // Create the crawl record first synchronously
          const crawl = createCrawl({ url: body.url, depth: body.depth, maxPages: body.maxPages });
          // Fire crawl in background — don't await
          startCrawl({ url: body.url, depth: body.depth, maxPages: body.maxPages }).catch(() => {});
          return json(crawl, 202); // 202 Accepted
        } else {
          const crawl = await startCrawl({ url: body.url, depth: body.depth, maxPages: body.maxPages });
          return json(crawl, 201);
        }
      } catch (err) {
        return json({ error: String(err) }, 500);
      }
    }

    // GET /v1/jobs — alias for GET /v1/crawls (shows all crawls including running)
    if (path === "/v1/jobs" && method === "GET") {
      const status = url.searchParams.get("status") ?? undefined;
      const limit = parseInt(url.searchParams.get("limit") ?? "50");
      const offset = parseInt(url.searchParams.get("offset") ?? "0");
      return json(listCrawls({ status, limit, offset }));
    }

    // GET /v1/crawls/:id
    const crawlMatch = path.match(/^\/v1\/crawls\/([^/]+)$/);
    if (crawlMatch && method === "GET") {
      const crawl = getCrawl(crawlMatch[1] as string);
      if (!crawl) return notFound("Crawl not found");
      const pages = listPages(crawl.id, { limit: 20 });
      return json({ ...crawl, pages });
    }

    // GET /v1/crawls/:id/pages
    const crawlPagesMatch = path.match(/^\/v1\/crawls\/([^/]+)\/pages$/);
    if (crawlPagesMatch && method === "GET") {
      const crawl = getCrawl(crawlPagesMatch[1] as string);
      if (!crawl) return notFound("Crawl not found");
      const limit = parseInt(url.searchParams.get("limit") ?? "50");
      const offset = parseInt(url.searchParams.get("offset") ?? "0");
      return json(listPages(crawl.id, { limit, offset }));
    }

    // GET /v1/pages/:id
    const pageMatch = path.match(/^\/v1\/pages\/([^/]+)$/);
    if (pageMatch && method === "GET") {
      const page = getPage(pageMatch[1] as string);
      if (!page) return notFound("Page not found");
      return json(page);
    }

    // GET /v1/search
    if (path === "/v1/search" && method === "GET") {
      const q = url.searchParams.get("q");
      if (!q) return badRequest("q is required");
      const domain = url.searchParams.get("domain") ?? undefined;
      const crawlId = url.searchParams.get("crawl_id") ?? undefined;
      const limit = parseInt(url.searchParams.get("limit") ?? "20");
      return json(searchPages(q, { domain, crawlId, limit }));
    }

    // GET /v1/export/:crawlId
    const exportMatch = path.match(/^\/v1\/export\/([^/]+)$/);
    if (exportMatch && method === "GET") {
      const format = (url.searchParams.get("format") ?? "json") as "json" | "md" | "csv";
      try {
        const { exportCrawl } = await import("../lib/export.js");
        const content = await exportCrawl(exportMatch[1] as string, format);
        const contentType = format === "json" ? "application/json" : format === "csv" ? "text/csv" : "text/markdown";
        return new Response(content, {
          headers: {
            "Content-Type": contentType,
            "X-API-Version": "1",
          },
        });
      } catch (err) {
        return json({ error: String(err) }, 500);
      }
    }

    // GET /v1/config
    if (path === "/v1/config" && method === "GET") {
      return json(getConfig());
    }

    // POST /v1/batch — batch scrape multiple URLs (always async)
    if (path === "/v1/batch" && method === "POST") {
      try {
        const body = await req.json() as { urls?: string[]; options?: Record<string, unknown> };
        if (!body.urls?.length) return badRequest("urls array is required");

        const { batchCrawl } = await import("../lib/crawler.js");

        // Always async — fire and return job ID
        const crawl = createCrawl({ url: body.urls[0] as string, maxPages: body.urls.length });
        batchCrawl(body.urls, body.options as Parameters<typeof batchCrawl>[1]).catch(() => {});

        return json({ jobId: crawl.id, urlCount: body.urls.length, status: "queued" }, 202);
      } catch (err) {
        return json({ error: String(err) }, 500);
      }
    }

    // GET /v1/batch/:id — alias to GET /v1/crawls/:id
    const batchGetMatch = path.match(/^\/v1\/batch\/([^/]+)$/);
    if (batchGetMatch && method === "GET") {
      const crawl = getCrawl(batchGetMatch[1] as string);
      if (!crawl) return notFound("Crawl not found");
      const pages = listPages(crawl.id, { limit: 20 });
      return json({ ...crawl, pages });
    }

    // POST /v1/map — discover all URLs on a website
    if (path === "/v1/map" && method === "POST") {
      try {
        const body = await req.json() as { url?: string; limit?: number; search?: string; allowSubdomains?: boolean };
        if (!body.url) return badRequest("url is required");

        const { mapSite } = await import("../lib/crawler.js");
        const urls = await mapSite(body.url, {
          limit: body.limit ?? 1000,
          search: body.search,
          allowSubdomains: body.allowSubdomains,
        });
        return json({ urls, count: urls.length });
      } catch (err) {
        return json({ error: String(err) }, 500);
      }
    }

    // GET /v1/webhooks
    if (path === "/v1/webhooks" && method === "GET") {
      return json(listWebhooks());
    }

    // POST /v1/webhooks
    if (path === "/v1/webhooks" && method === "POST") {
      try {
        const body = await req.json() as { url?: string; events?: string[]; secret?: string };
        if (!body.url) return badRequest("url is required");
        const webhook = createWebhook({
          url: body.url,
          events: body.events as Parameters<typeof createWebhook>[0]["events"],
          secret: body.secret,
        });
        return json(webhook, 201);
      } catch (err) {
        return json({ error: String(err) }, 500);
      }
    }

    // POST /v1/webhooks/retry — retry all failed pending deliveries
    if (path === "/v1/webhooks/retry" && method === "POST") {
      try {
        const retried = await retryFailedDeliveries();
        return json({ retried });
      } catch (err) {
        return json({ error: String(err) }, 500);
      }
    }

    // GET /v1/webhooks/:id
    const webhookMatch = path.match(/^\/v1\/webhooks\/([^/]+)$/);
    if (webhookMatch && method === "GET") {
      const webhook = getWebhook(webhookMatch[1] as string);
      if (!webhook) return notFound("Webhook not found");
      return json(webhook);
    }

    // DELETE /v1/webhooks/:id
    if (webhookMatch && method === "DELETE") {
      const webhook = getWebhook(webhookMatch[1] as string);
      if (!webhook) return notFound("Webhook not found");
      deleteWebhook(webhookMatch[1] as string);
      return json({ deleted: true, id: webhookMatch[1] });
    }

    // POST /v1/webhooks/:id/test
    const webhookTestMatch = path.match(/^\/v1\/webhooks\/([^/]+)\/test$/);
    if (webhookTestMatch && method === "POST") {
      try {
        const webhookId = webhookTestMatch[1] as string;
        const webhook = getWebhook(webhookId);
        if (!webhook) return notFound("Webhook not found");
        const payload = JSON.stringify({
          crawlId: "test",
          url: "https://example.com",
          pagesCrawled: 1,
          status: "completed",
          event: "crawl.completed",
          timestamp: new Date().toISOString(),
        });
        const delivery = createDelivery({ webhookId, event: "crawl.completed", payload });
        const success = await deliverWebhook(delivery.id);
        const { getDelivery } = await import("../db/webhooks.js");
        const updated = getDelivery(delivery.id);
        return json({
          success,
          httpStatus: updated?.httpStatus ?? null,
          responseBody: updated?.responseBody ?? null,
        });
      } catch (err) {
        return json({ error: String(err) }, 500);
      }
    }

    // GET /v1/webhooks/:id/deliveries
    const webhookDeliveriesMatch = path.match(/^\/v1\/webhooks\/([^/]+)\/deliveries$/);
    if (webhookDeliveriesMatch && method === "GET") {
      const webhookId = webhookDeliveriesMatch[1] as string;
      const webhook = getWebhook(webhookId);
      if (!webhook) return notFound("Webhook not found");
      const limit = parseInt(url.searchParams.get("limit") ?? "50");
      return json(listDeliveries(webhookId, limit));
    }

    return notFound();
  },
});

console.log(`open-crawl server running on http://localhost:${PORT}`);
