/**
 * HTTP server for the MCP registry dashboard.
 * Serves the Vite-built React/shadcn dashboard from dashboard/dist/.
 * Provides API routes for managing MCP servers.
 */

import { existsSync } from "fs";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";
import {
  listServers,
  getServer,
  addServer,
  removeServer,
  enableServer,
  disableServer,
  getCachedTools,
} from "../lib/registry.js";
import { getDb, closeDb } from "../lib/db.js";

interface ServerWithToolCount {
  id: string;
  name: string;
  description: string | null;
  command: string;
  args: string[];
  env: Record<string, string>;
  transport: string;
  url: string | null;
  source: string;
  enabled: boolean;
  toolCount: number;
  created_at: string;
  updated_at: string;
}

function resolveDashboardDir(): string {
  const candidates: string[] = [];

  try {
    const scriptDir = dirname(fileURLToPath(import.meta.url));
    candidates.push(join(scriptDir, "..", "dashboard", "dist"));
    candidates.push(join(scriptDir, "..", "..", "dashboard", "dist"));
  } catch {
    // import.meta.url may not resolve in all contexts
  }

  if (process.argv[1]) {
    const mainDir = dirname(process.argv[1]);
    candidates.push(join(mainDir, "..", "dashboard", "dist"));
    candidates.push(join(mainDir, "..", "..", "dashboard", "dist"));
  }

  candidates.push(join(process.cwd(), "dashboard", "dist"));

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return join(process.cwd(), "dashboard", "dist");
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function json(data: unknown, status = 200, port?: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": port ? `http://localhost:${port}` : "*",
      ...SECURITY_HEADERS,
    },
  });
}

function isValidId(id: string): boolean {
  return /^[a-z0-9-]+$/.test(id);
}

const MAX_BODY_SIZE = 1024 * 1024;

function getAllServersWithToolCount(): ServerWithToolCount[] {
  const servers = listServers();
  return servers.map((s) => ({
    ...s,
    toolCount: getCachedTools(s.id).length,
  }));
}

function serveStaticFile(filePath: string): Response | null {
  if (!existsSync(filePath)) return null;

  const ext = extname(filePath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  return new Response(Bun.file(filePath), {
    headers: { "Content-Type": contentType },
  });
}

export async function startServer(port: number, options?: { open?: boolean }): Promise<void> {
  const shouldOpen = options?.open ?? true;

  // Ensure DB is initialized
  getDb();

  const dashboardDir = resolveDashboardDir();
  const dashboardExists = existsSync(dashboardDir);

  if (!dashboardExists) {
    console.error(`\nDashboard not found at: ${dashboardDir}`);
    console.error(`Run this to build it:\n`);
    console.error(`  cd dashboard && bun install && bun run build\n`);
  }

  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method;

      // ── API Routes ──

      // GET /api/servers
      if (path === "/api/servers" && method === "GET") {
        return json(getAllServersWithToolCount(), 200, port);
      }

      // POST /api/servers (add)
      if (path === "/api/servers" && method === "POST") {
        try {
          const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
          if (contentLength > MAX_BODY_SIZE) return json({ error: "Request body too large" }, 413, port);
          const body = (await req.json()) as {
            name?: string;
            command: string;
            args?: string[];
            description?: string;
            transport?: string;
            url?: string;
          };
          if (!body.command) return json({ error: "Missing 'command'" }, 400, port);
          const entry = addServer({
            name: body.name,
            command: body.command,
            args: body.args || [],
            description: body.description,
            transport: (body.transport as any) || "stdio",
            url: body.url,
          });
          return json(entry, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed to add server" }, 500, port);
        }
      }

      // GET /api/servers/:id
      const singleMatch = path.match(/^\/api\/servers\/([^/]+)$/);
      if (singleMatch && method === "GET") {
        const id = singleMatch[1];
        if (!isValidId(id)) return json({ error: "Invalid server ID" }, 400, port);
        const entry = getServer(id);
        if (!entry) return json({ error: `Server '${id}' not found` }, 404, port);
        const tools = getCachedTools(id);
        return json({ ...entry, toolCount: tools.length, tools }, 200, port);
      }

      // DELETE /api/servers/:id
      if (singleMatch && method === "DELETE") {
        const id = singleMatch[1];
        if (!isValidId(id)) return json({ error: "Invalid server ID" }, 400, port);
        const entry = getServer(id);
        if (!entry) return json({ error: `Server '${id}' not found` }, 404, port);
        removeServer(id);
        return json({ success: true }, 200, port);
      }

      // POST /api/servers/:id/enable
      const enableMatch = path.match(/^\/api\/servers\/([^/]+)\/enable$/);
      if (enableMatch && method === "POST") {
        const id = enableMatch[1];
        if (!isValidId(id)) return json({ error: "Invalid server ID" }, 400, port);
        try {
          enableServer(id);
          return json({ success: true }, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed" }, 500, port);
        }
      }

      // POST /api/servers/:id/disable
      const disableMatch = path.match(/^\/api\/servers\/([^/]+)\/disable$/);
      if (disableMatch && method === "POST") {
        const id = disableMatch[1];
        if (!isValidId(id)) return json({ error: "Invalid server ID" }, 400, port);
        try {
          disableServer(id);
          return json({ success: true }, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed" }, 500, port);
        }
      }

      // ── CORS ──
      if (method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Origin": `http://localhost:${port}`,
            "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }

      // ── Static Files (Vite dashboard) ──
      if (dashboardExists && (method === "GET" || method === "HEAD")) {
        if (path !== "/") {
          const filePath = join(dashboardDir, path);
          const res = serveStaticFile(filePath);
          if (res) return res;
        }

        // SPA fallback
        const indexPath = join(dashboardDir, "index.html");
        const res = serveStaticFile(indexPath);
        if (res) return res;
      }

      return json({ error: "Not found" }, 404, port);
    },
  });

  const shutdown = () => {
    server.stop();
    closeDb();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const serverUrl = `http://localhost:${port}`;
  console.log(`MCPs Dashboard running at ${serverUrl}`);

  if (shouldOpen) {
    try {
      const { exec } = await import("child_process");
      const openCmd = process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "start"
          : "xdg-open";
      exec(`${openCmd} ${serverUrl}`);
    } catch {
      // Silently ignore if we can't open browser
    }
  }
}
