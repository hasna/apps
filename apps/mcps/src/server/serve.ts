/**
 * HTTP server for the MCP registry dashboard.
 * Serves the Vite-built React/shadcn dashboard from dashboard/dist/.
 * Provides API routes for managing MCP servers.
 */

import { existsSync } from "fs";
import { join, dirname, extname, resolve, relative, sep } from "path";
import { fileURLToPath } from "url";
import {
  listServers,
  getServer,
  addServer,
  removeServer,
  enableServer,
  disableServer,
  getCachedTools,
  getToolCounts,
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

function redactServer<T extends { env: Record<string, string> }>(server: T): T {
  return { ...server, env: {} };
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
  "Referrer-Policy": "no-referrer",
};

function json(data: unknown, status = 200, port?: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": port ? `http://localhost:${port}` : "*",
      ...SECURITY_HEADERS,
    },
  });
}

function isValidId(id: string): boolean {
  return /^[a-z0-9-]+$/.test(id);
}

const MAX_BODY_SIZE = 1024 * 1024;

function isLoopbackHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function isAllowedOrigin(req: Request, port: number, host: string): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  if (origin === "null") return false;
  try {
    const url = new URL(origin);
    if (url.port && url.port !== String(port)) return false;
    if (isLoopbackHost(url.hostname)) return true;
    const normalizedHost = host === "0.0.0.0" ? "127.0.0.1" : host;
    return url.hostname === normalizedHost;
  } catch {
    return false;
  }
}

function isAuthorized(req: Request, host: string): boolean {
  const token = process.env.MCPS_API_TOKEN;
  if (!token) {
    return isLoopbackHost(host);
  }
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${token}`) return true;
  return isLoopbackHost(host);
}

function unauthorizedResponse(port: number): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": port ? `http://localhost:${port}` : "*",
      "WWW-Authenticate": "Bearer",
      ...SECURITY_HEADERS,
    },
  });
}

function getAllServersWithToolCount(): ServerWithToolCount[] {
  const servers = listServers();
  if (servers.length === 0) return [];
  const counts = getToolCounts();
  return servers.map((s) => ({
    ...redactServer(s),
    toolCount: counts.get(s.id) ?? 0,
  }));
}

function serveStaticFile(filePath: string): Response | null {
  if (!existsSync(filePath)) return null;

  const ext = extname(filePath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  return new Response(Bun.file(filePath), {
    headers: { "Content-Type": contentType, ...SECURITY_HEADERS },
  });
}

function resolveStaticPath(baseDir: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const stripped = decoded.replace(/^\/+/, "");
  const resolved = resolve(baseDir, stripped);
  const rel = relative(baseDir, resolved);
  if (rel.startsWith("..") || rel.includes(`..${sep}`)) {
    return null;
  }
  return resolved;
}

function formatHostForUrl(host: string): string {
  if (host.includes(":") && !host.startsWith("[")) return `[${host}]`;
  return host;
}

export async function startServer(
  port: number,
  options?: { open?: boolean; host?: string }
): Promise<void> {
  const shouldOpen = options?.open ?? true;
  const host = options?.host ?? "127.0.0.1";

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
    hostname: host,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method;

      if (path.startsWith("/api/") && method !== "OPTIONS") {
        if (!isAuthorized(req, host)) {
          return unauthorizedResponse(port);
        }
        if (!isAllowedOrigin(req, port, host)) {
          return json({ error: "Forbidden" }, 403, port);
        }
      }

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
          let body: {
            name?: string;
            command?: string;
            args?: unknown;
            description?: string;
            transport?: string;
            url?: string;
          };
          try {
            body = (await req.json()) as typeof body;
          } catch {
            return json({ error: "Invalid JSON body" }, 400, port);
          }
          const command = body.command?.trim();
          if (!command) return json({ error: "Missing 'command'" }, 400, port);
          const transport = body.transport || "stdio";
          if (!["stdio", "sse", "streamable-http"].includes(transport)) {
            return json({ error: "Invalid transport type" }, 400, port);
          }
          if (transport !== "stdio" && !body.url) {
            return json({ error: "Missing 'url' for non-stdio transport" }, 400, port);
          }
          if (body.url) {
            try {
              new URL(body.url);
            } catch {
              return json({ error: "Invalid 'url' format" }, 400, port);
            }
          }
          if (body.args && (!Array.isArray(body.args) || body.args.some((arg) => typeof arg !== "string"))) {
            return json({ error: "Invalid 'args' format" }, 400, port);
          }
          const args = (body.args as string[]) || [];
          const entry = addServer({
            name: body.name,
            command,
            args,
            description: body.description,
            transport: transport as any,
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
        return json({ ...redactServer(entry), toolCount: tools.length, tools }, 200, port);
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
          const existing = getServer(id);
          if (!existing) return json({ error: `Server '${id}' not found` }, 404, port);
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
          const existing = getServer(id);
          if (!existing) return json({ error: `Server '${id}' not found` }, 404, port);
          disableServer(id);
          return json({ success: true }, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed" }, 500, port);
        }
      }

      // POST /api/update — self-update the package
      if (path === "/api/update" && method === "POST") {
        if (!isLoopbackHost(host)) {
          return json({ error: "Update only allowed on loopback host" }, 403, port);
        }
        try {
          const { execFileSync } = await import("child_process");
          const pkg = await import("../../package.json");
          const currentVersion = pkg.version;
          const latest = execFileSync("npm", ["view", "@hasna/mcps", "version"], {
            encoding: "utf-8",
          }).trim();
          if (latest === currentVersion) {
            return json({ success: true, current: currentVersion, latest, upToDate: true }, 200, port);
          }
          execFileSync("bun", ["install", "-g", "@hasna/mcps@latest"], { stdio: "pipe" });
          return json({ success: true, current: currentVersion, latest, upToDate: false, updated: true }, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Update failed" }, 500, port);
        }
      }

      // GET /api/version — get current version info
      if (path === "/api/version" && method === "GET") {
        try {
          const pkg = await import("../../package.json");
          return json({ version: pkg.version }, 200, port);
        } catch {
          return json({ version: "unknown" }, 200, port);
        }
      }

      // ── CORS ──
      if (method === "OPTIONS") {
        if (!isAllowedOrigin(req, port, host)) {
          return json({ error: "Forbidden" }, 403, port);
        }
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
          const safePath = resolveStaticPath(dashboardDir, path);
          if (safePath) {
            const res = serveStaticFile(safePath);
            if (res) return res;
          }
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

  const displayHost = host === "0.0.0.0" ? "localhost" : host;
  const serverUrl = `http://${formatHostForUrl(displayHost)}:${port}`;
  console.log(`MCPs Dashboard running at ${serverUrl}`);

  if (shouldOpen) {
    try {
      const { execFile } = await import("child_process");
      if (process.platform === "win32") {
        execFile("cmd", ["/c", "start", "", serverUrl]);
      } else {
        const openCmd = process.platform === "darwin" ? "open" : "xdg-open";
        execFile(openCmd, [serverUrl]);
      }
    } catch {
      // Silently ignore if we can't open browser
    }
  }
}
