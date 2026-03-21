#!/usr/bin/env bun
import { listCrawls, getCrawl } from "../db/crawls.js";
import { listPages, getPage, searchPages } from "../db/pages.js";
import { getConfig } from "../lib/config.js";

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
      const [crawls] = await Promise.all([fetch('/api/crawls').then(r => r.json())]);
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
          <td><a href="/api/crawls/\${c.id}">\${c.url}</a></td>
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
      const data = await fetch(\`/api/search?q=\${encodeURIComponent(q)}&limit=10\`).then(r => r.json());
      document.getElementById('results').innerHTML = data.map(r => \`
        <div class="result">
          <a href="/api/pages/\${r.page.id}">\${r.page.title || r.page.url}</a>
          <p>\${r.page.url}</p>
          <p>\${r.snippet}</p>
        </div>
      \`).join('') || '<p style="color:#666;padding:8px">No results.</p>';
    }
    load();
  </script>
</body>
</html>`;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function notFound(msg = "Not found") {
  return json({ error: msg }, 404);
}

function badRequest(msg: string) {
  return json({ error: msg }, 400);
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // Dashboard
    if (path === "/" || path === "/dashboard") {
      return new Response(DASHBOARD_HTML, {
        headers: { "Content-Type": "text/html" },
      });
    }

    // GET /api/crawls
    if (path === "/api/crawls" && method === "GET") {
      const status = url.searchParams.get("status") ?? undefined;
      const limit = parseInt(url.searchParams.get("limit") ?? "50");
      const offset = parseInt(url.searchParams.get("offset") ?? "0");
      return json(listCrawls({ status, limit, offset }));
    }

    // POST /api/crawls
    if (path === "/api/crawls" && method === "POST") {
      try {
        const body = await req.json() as { url?: string; depth?: number; maxPages?: number };
        if (!body.url) return badRequest("url is required");
        const { startCrawl } = await import("../lib/crawler.js");
        const crawl = await startCrawl({
          url: body.url,
          depth: body.depth,
          maxPages: body.maxPages,
        });
        return json(crawl, 201);
      } catch (err) {
        return json({ error: String(err) }, 500);
      }
    }

    // GET /api/crawls/:id
    const crawlMatch = path.match(/^\/api\/crawls\/([^/]+)$/);
    if (crawlMatch && method === "GET") {
      const crawl = getCrawl(crawlMatch[1] as string);
      if (!crawl) return notFound("Crawl not found");
      const pages = listPages(crawl.id, { limit: 20 });
      return json({ ...crawl, pages });
    }

    // GET /api/crawls/:id/pages
    const crawlPagesMatch = path.match(/^\/api\/crawls\/([^/]+)\/pages$/);
    if (crawlPagesMatch && method === "GET") {
      const crawl = getCrawl(crawlPagesMatch[1] as string);
      if (!crawl) return notFound("Crawl not found");
      const limit = parseInt(url.searchParams.get("limit") ?? "50");
      const offset = parseInt(url.searchParams.get("offset") ?? "0");
      return json(listPages(crawl.id, { limit, offset }));
    }

    // GET /api/pages/:id
    const pageMatch = path.match(/^\/api\/pages\/([^/]+)$/);
    if (pageMatch && method === "GET") {
      const page = getPage(pageMatch[1] as string);
      if (!page) return notFound("Page not found");
      return json(page);
    }

    // GET /api/search
    if (path === "/api/search" && method === "GET") {
      const q = url.searchParams.get("q");
      if (!q) return badRequest("q is required");
      const domain = url.searchParams.get("domain") ?? undefined;
      const crawlId = url.searchParams.get("crawl_id") ?? undefined;
      const limit = parseInt(url.searchParams.get("limit") ?? "20");
      return json(searchPages(q, { domain, crawlId, limit }));
    }

    // GET /api/export/:crawlId
    const exportMatch = path.match(/^\/api\/export\/([^/]+)$/);
    if (exportMatch && method === "GET") {
      const format = (url.searchParams.get("format") ?? "json") as "json" | "md" | "csv";
      try {
        const { exportCrawl } = await import("../lib/export.js");
        const content = await exportCrawl(exportMatch[1] as string, format);
        const contentType = format === "json" ? "application/json" : format === "csv" ? "text/csv" : "text/markdown";
        return new Response(content, { headers: { "Content-Type": contentType } });
      } catch (err) {
        return json({ error: String(err) }, 500);
      }
    }

    // GET /api/config
    if (path === "/api/config" && method === "GET") {
      return json(getConfig());
    }

    return notFound();
  },
});

console.log(`open-crawl server running on http://localhost:${PORT}`);
