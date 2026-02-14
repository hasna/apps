/**
 * Reusable server starter for the connector auth dashboard.
 * Used by both the CLI `serve` command and the standalone `connectors-serve` binary.
 * Serves the Vite-built React/shadcn dashboard from dashboard/dist/.
 */

import { existsSync } from "fs";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";
import {
  CONNECTORS,
  getConnector,
  loadConnectorVersions,
} from "../lib/registry.js";
import { getInstalledConnectors, getConnectorDocs } from "../lib/installer.js";
import {
  getAuthStatus,
  saveApiKey,
  getOAuthStartUrl,
  exchangeOAuthCode,
  refreshOAuthToken,
  validateOAuthState,
  type AuthStatus,
} from "./auth.js";

interface ConnectorWithAuth {
  name: string;
  displayName: string;
  description: string;
  category: string;
  version?: string;
  installed: boolean;
  auth: AuthStatus | null;
}

// Resolve the dashboard dist directory — check multiple locations
function resolveDashboardDir(): string {
  const candidates: string[] = [];

  // Relative to the script file (works for both source and built)
  try {
    const scriptDir = dirname(fileURLToPath(import.meta.url));
    candidates.push(join(scriptDir, "..", "dashboard", "dist"));
    candidates.push(join(scriptDir, "..", "..", "dashboard", "dist"));
  } catch {
    // import.meta.url may not resolve in all contexts
  }

  // Relative to the main script (process.argv[1])
  if (process.argv[1]) {
    const mainDir = dirname(process.argv[1]);
    candidates.push(join(mainDir, "..", "dashboard", "dist"));
    candidates.push(join(mainDir, "..", "..", "dashboard", "dist"));
  }

  // Relative to cwd (most reliable for local use)
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

function htmlResponse(content: string, status = 200): Response {
  return new Response(content, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...SECURITY_HEADERS },
  });
}

/** Validate connector name to prevent path traversal */
function isValidConnectorName(name: string): boolean {
  return /^[a-z0-9-]+$/.test(name);
}

/** Max request body size (1MB) */
const MAX_BODY_SIZE = 1024 * 1024;

function getAllConnectorsWithAuth(): ConnectorWithAuth[] {
  const installed = new Set(getInstalledConnectors());
  return CONNECTORS.map((meta) => {
    const isInstalled = installed.has(meta.name);
    const auth = isInstalled ? getAuthStatus(meta.name) : null;
    return {
      name: meta.name,
      displayName: meta.displayName,
      description: meta.description,
      category: meta.category,
      version: meta.version,
      installed: isInstalled,
      auth,
    };
  });
}

function errorPage(title: string, message: string, hint?: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:var(--bg,#0a0a0a);color:var(--fg,#e5e5e5);">
    <style>@media(prefers-color-scheme:light){:root{--bg:#fff;--fg:#111;--sub:#666;--hint:#888}}:root{--bg:#0a0a0a;--fg:#e5e5e5;--sub:#888;--hint:#666}</style>
    <div style="text-align:center;">
      <h2 style="color:#ef4444;">${title}</h2>
      <p style="color:var(--sub);">${message}</p>
      ${hint ? `<p style="color:var(--hint);font-size:14px;">${hint}</p>` : ""}
    </div>
  </body></html>`;
}

function serveStaticFile(filePath: string): Response | null {
  if (!existsSync(filePath)) return null;

  const ext = extname(filePath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  return new Response(Bun.file(filePath), {
    headers: { "Content-Type": contentType },
  });
}

export interface ServeOptions {
  port: number;
  open?: boolean;
}

export async function startServer(port: number, options?: { open?: boolean }): Promise<void> {
  const shouldOpen = options?.open ?? true;
  loadConnectorVersions();

  const dashboardDir = resolveDashboardDir();
  const dashboardExists = existsSync(dashboardDir);

  if (!dashboardExists) {
    console.error(`\nDashboard not found at: ${dashboardDir}`);
    console.error(`Run this to build it:\n`);
    console.error(`  cd dashboard && bun install && bun run build\n`);
    console.error(`Or from the project root:\n`);
    console.error(`  bun run build:dashboard\n`);
  }

  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method;

      // ── API Routes ──

      // GET /api/connectors
      if (path === "/api/connectors" && method === "GET") {
        return json(getAllConnectorsWithAuth(), 200, port);
      }

      // GET /api/connectors/:name
      const singleMatch = path.match(/^\/api\/connectors\/([^/]+)$/);
      if (singleMatch && method === "GET") {
        const name = singleMatch[1];
        if (!isValidConnectorName(name)) return json({ error: "Invalid connector name" }, 400, port);
        const meta = getConnector(name);
        if (!meta) return json({ error: `Connector '${name}' not found` }, 404, port);

        const auth = getAuthStatus(name);
        const docs = getConnectorDocs(name);
        return json({
          name: meta.name,
          displayName: meta.displayName,
          description: meta.description,
          category: meta.category,
          version: meta.version,
          auth,
          overview: docs?.overview || null,
        }, 200, port);
      }

      // POST /api/connectors/:name/key
      const keyMatch = path.match(/^\/api\/connectors\/([^/]+)\/key$/);
      if (keyMatch && method === "POST") {
        const name = keyMatch[1];
        if (!isValidConnectorName(name)) return json({ error: "Invalid connector name" }, 400, port);
        try {
          const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
          if (contentLength > MAX_BODY_SIZE) return json({ error: "Request body too large" }, 413, port);
          const body = (await req.json()) as { key: string; field?: string };
          if (!body.key) return json({ error: "Missing 'key' in request body" }, 400, port);
          saveApiKey(name, body.key, body.field);
          return json({ success: true }, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed to save key" }, 500, port);
        }
      }

      // POST /api/connectors/:name/refresh
      const refreshMatch = path.match(/^\/api\/connectors\/([^/]+)\/refresh$/);
      if (refreshMatch && method === "POST") {
        const name = refreshMatch[1];
        if (!isValidConnectorName(name)) return json({ error: "Invalid connector name" }, 400, port);
        try {
          const tokens = await refreshOAuthToken(name);
          return json({ success: true, expiresAt: tokens.expiresAt }, 200, port);
        } catch (e) {
          return json(
            { success: false, error: e instanceof Error ? e.message : "Failed to refresh" },
            500, port
          );
        }
      }

      // ── OAuth Routes ──

      // GET /oauth/:name/start
      const oauthStartMatch = path.match(/^\/oauth\/([^/]+)\/start$/);
      if (oauthStartMatch && method === "GET") {
        const name = oauthStartMatch[1];
        const redirectUri = `http://localhost:${port}/oauth/${name}/callback`;
        const authUrl = getOAuthStartUrl(name, redirectUri);

        if (!authUrl) {
          return htmlResponse(errorPage(
            "OAuth Not Available",
            `No OAuth client credentials found for <strong>${name}</strong>.`,
            `Set up credentials at <code>~/.connect/connect-${name}/credentials.json</code>`
          ));
        }

        return Response.redirect(authUrl, 302);
      }

      // GET /oauth/:name/callback
      const oauthCallbackMatch = path.match(/^\/oauth\/([^/]+)\/callback$/);
      if (oauthCallbackMatch && method === "GET") {
        const name = oauthCallbackMatch[1];
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        const state = url.searchParams.get("state");

        if (error) {
          return htmlResponse(errorPage("Authentication Failed", error, "You can close this window."));
        }

        if (!validateOAuthState(state, name)) {
          return htmlResponse(errorPage(
            "Invalid State",
            "CSRF validation failed. The OAuth state parameter is missing or invalid.",
            "Please try again from the dashboard."
          ));
        }

        if (!code) {
          return htmlResponse(errorPage(
            "Missing Authorization Code",
            "No code received from the OAuth provider.",
            "You can close this window and try again."
          ));
        }

        try {
          const redirectUri = `http://localhost:${port}/oauth/${name}/callback`;
          await exchangeOAuthCode(name, code, redirectUri);

          return htmlResponse(`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#0a0a0a;color:#e5e5e5;">
            <div style="text-align:center;">
              <h2 style="color:#22c55e;">Connected!</h2>
              <p style="color:#888;"><strong>${name}</strong> is now authenticated.</p>
              <p style="color:#666;font-size:14px;">You can close this window and return to the dashboard.</p>
              <script>
                if (window.opener) {
                  window.opener.postMessage({ type: 'oauth-complete', connector: '${name}' }, 'http://localhost:${port}');
                }
              </script>
            </div>
          </body></html>`);
        } catch (e) {
          return htmlResponse(errorPage(
            "Authentication Failed",
            e instanceof Error ? e.message : "Unknown error",
            "You can close this window."
          ));
        }
      }

      // ── CORS ──
      if (method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Origin": `http://localhost:${port}`,
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }

      // ── Static Files (Vite dashboard) ──
      if (dashboardExists && (method === "GET" || method === "HEAD")) {
        // Try to serve exact file (e.g., /assets/index-abc123.js)
        if (path !== "/") {
          const filePath = join(dashboardDir, path);
          const res = serveStaticFile(filePath);
          if (res) return res;
        }

        // SPA fallback: serve index.html for all other GET routes
        const indexPath = join(dashboardDir, "index.html");
        const res = serveStaticFile(indexPath);
        if (res) return res;
      }

      return json({ error: "Not found" }, 404, port);
    },
  });

  // Graceful shutdown
  const shutdown = () => {
    server.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const url = `http://localhost:${port}`;
  console.log(`Connectors Dashboard running at ${url}`);

  if (shouldOpen) {
    try {
      const { exec } = await import("child_process");
      const openCmd = process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "start"
          : "xdg-open";
      exec(`${openCmd} ${url}`);
    } catch {
      // Silently ignore if we can't open browser
    }
  }
}
