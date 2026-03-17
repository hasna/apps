/**
 * Reusable server starter for the connector auth dashboard.
 * Used by both the CLI `serve` command and the standalone `connectors-serve` binary.
 * Serves the Vite-built React/shadcn dashboard from dashboard/dist/.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { registerAgent, listAgents, getAgentByName, deleteAgent, isAgentConflict } from "../db/agents.js";
import { join, dirname, extname, basename } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";
import {
  CONNECTORS,
  getConnector,
  loadConnectorVersions,
} from "../lib/registry.js";
import { getInstalledConnectors, getConnectorDocs, installConnector, removeConnector } from "../lib/installer.js";
import {
  getAuthStatus,
  saveApiKey,
  getOAuthStartUrl,
  exchangeOAuthCode,
  refreshOAuthToken,
  validateOAuthState,
  listProfiles,
  switchProfile,
  deleteProfile,
  type AuthStatus,
} from "./auth.js";

// ── Activity Log ──
interface ActivityEntry {
  action: string;
  connector: string;
  timestamp: number;
  detail?: string;
}

const activityLog: ActivityEntry[] = [];
const MAX_ACTIVITY_LOG = 100;

function logActivity(action: string, connector: string, detail?: string) {
  activityLog.unshift({ action, connector, timestamp: Date.now(), detail });
  if (activityLog.length > MAX_ACTIVITY_LOG) {
    activityLog.length = MAX_ACTIVITY_LOG;
  }
}

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

async function findAvailablePort(preferred: number): Promise<number> {
  for (let port = preferred; port < preferred + 100; port++) {
    try {
      const server = Bun.serve({ port, fetch() { return new Response(); } });
      server.stop(true);
      return port;
    } catch {
      // Port in use, try next
    }
  }
  throw new Error(`No available port found in range ${preferred}-${preferred + 99}`);
}

export async function startServer(requestedPort: number, options?: { open?: boolean }): Promise<void> {
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

  const port = await findAvailablePort(requestedPort);
  if (port !== requestedPort) {
    console.log(`Port ${requestedPort} is in use, using port ${port} instead`);
  }

  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method;

      // ── API Routes ──

      // GET /api/connectors[?compact=true][?fields=name,category,installed]
      if (path === "/api/connectors" && method === "GET") {
        const compact = url.searchParams.get("compact") === "true";
        const fieldsParam = url.searchParams.get("fields");
        const fields = fieldsParam ? new Set(fieldsParam.split(",").map((f) => f.trim())) : null;

        const data = getAllConnectorsWithAuth();

        if (compact) {
          // Compact: name + category + installed only (~61% smaller)
          return json(data.map((c) => ({ name: c.name, category: c.category, installed: c.installed })), 200, port);
        }

        if (fields) {
          // Field filtering: return only requested fields
          return json(data.map((c) => {
            const out: Record<string, unknown> = {};
            for (const f of fields) {
              if (f in c) out[f] = (c as unknown as Record<string, unknown>)[f];
            }
            return out;
          }), 200, port);
        }

        return json(data, 200, port);
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
          logActivity("key_saved", name, body.field ? `Field: ${body.field}` : undefined);
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
          logActivity("token_refreshed", name, tokens.expiresAt ? `Expires: ${new Date(tokens.expiresAt).toISOString()}` : undefined);
          return json({ success: true, expiresAt: tokens.expiresAt }, 200, port);
        } catch (e) {
          return json(
            { success: false, error: e instanceof Error ? e.message : "Failed to refresh" },
            500, port
          );
        }
      }

      // POST /api/connectors/:name/install
      const installMatch = path.match(/^\/api\/connectors\/([^/]+)\/install$/);
      if (installMatch && method === "POST") {
        const name = installMatch[1];
        if (!isValidConnectorName(name)) return json({ error: "Invalid connector name" }, 400, port);
        const meta = getConnector(name);
        if (!meta) return json({ error: `Connector '${name}' not found` }, 404, port);
        try {
          const result = installConnector(name);
          if (!result.success) {
            return json({ error: result.error || "Failed to install connector" }, 500, port);
          }
          logActivity("installed", name);
          return json({ success: true, name }, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed to install connector" }, 500, port);
        }
      }

      // POST /api/connectors/:name/uninstall
      const uninstallMatch = path.match(/^\/api\/connectors\/([^/]+)\/uninstall$/);
      if (uninstallMatch && method === "POST") {
        const name = uninstallMatch[1];
        if (!isValidConnectorName(name)) return json({ error: "Invalid connector name" }, 400, port);
        try {
          const removed = removeConnector(name);
          if (!removed) {
            return json({ error: `Connector '${name}' is not installed` }, 404, port);
          }
          logActivity("uninstalled", name);
          return json({ success: true, name }, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed to uninstall connector" }, 500, port);
        }
      }

      // POST /api/update — re-install all installed connectors from package
      if (path === "/api/update" && method === "POST") {
        try {
          const installed = getInstalledConnectors();
          if (installed.length === 0) {
            return json({ updated: [], count: 0 }, 200, port);
          }
          const results = installed.map((name) =>
            installConnector(name, { overwrite: true })
          );
          return json({
            results,
            count: results.filter((r) => r.success).length,
            total: installed.length,
          }, 200, port);
        } catch (e) {
          return json(
            { error: e instanceof Error ? e.message : "Failed to update" },
            500, port
          );
        }
      }

      // GET /api/activity
      if (path === "/api/activity" && method === "GET") {
        return json(activityLog, 200, port);
      }

      // ── Agent Routes ──

      // GET /api/agents
      if (path === "/api/agents" && method === "GET") {
        return json(listAgents(), 200, port);
      }

      // POST /api/agents/register
      if (path === "/api/agents/register" && method === "POST") {
        const body = await req.json().catch(() => ({})) as Record<string, unknown>;
        const name = typeof body.name === "string" ? body.name : null;
        if (!name) return json({ error: "name is required" }, 400, port);
        const result = registerAgent({
          name,
          session_id: typeof body.session_id === "string" ? body.session_id : undefined,
          role: typeof body.role === "string" ? body.role : undefined,
        });
        if (isAgentConflict(result)) return json(result, 409, port);
        return json(result, 200, port);
      }

      // DELETE /api/agents/:name
      if (path.startsWith("/api/agents/") && method === "DELETE") {
        const agentName = path.slice("/api/agents/".length);
        const agent = getAgentByName(agentName);
        if (!agent) return json({ error: "Agent not found" }, 404, port);
        deleteAgent(agent.id);
        return json({ success: true }, 200, port);
      }

      // ── Profile Routes ──

      // GET /api/connectors/:name/profiles
      const profilesMatch = path.match(/^\/api\/connectors\/([^/]+)\/profiles$/);
      if (profilesMatch && method === "GET") {
        const name = profilesMatch[1];
        if (!isValidConnectorName(name)) return json({ error: "Invalid connector name" }, 400, port);
        try {
          const profiles = listProfiles(name);
          const configDir = join(homedir(), ".connectors", name.startsWith("connect-") ? name : `connect-${name}`);
          const currentProfileFile = join(configDir, "current_profile");
          let current = "default";
          if (existsSync(currentProfileFile)) {
            try { current = readFileSync(currentProfileFile, "utf-8").trim() || "default"; } catch { /* default */ }
          }
          return json({ current, profiles }, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed to list profiles" }, 500, port);
        }
      }

      // POST /api/connectors/:name/profiles/switch
      const profileSwitchMatch = path.match(/^\/api\/connectors\/([^/]+)\/profiles\/switch$/);
      if (profileSwitchMatch && method === "POST") {
        const name = profileSwitchMatch[1];
        if (!isValidConnectorName(name)) return json({ error: "Invalid connector name" }, 400, port);
        try {
          const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
          if (contentLength > MAX_BODY_SIZE) return json({ error: "Request body too large" }, 413, port);
          const body = (await req.json()) as { profile: string };
          if (!body.profile) return json({ error: "Missing 'profile' in request body" }, 400, port);
          switchProfile(name, body.profile);
          logActivity("profile_switch", name, `Switched to profile: ${body.profile}`);
          return json({ success: true, profile: body.profile }, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed to switch profile" }, 500, port);
        }
      }

      // DELETE /api/connectors/:name/profiles/:profile
      const profileDeleteMatch = path.match(/^\/api\/connectors\/([^/]+)\/profiles\/([^/]+)$/);
      if (profileDeleteMatch && method === "DELETE") {
        const name = profileDeleteMatch[1];
        const profile = profileDeleteMatch[2];
        if (!isValidConnectorName(name)) return json({ error: "Invalid connector name" }, 400, port);
        if (profile === "default") return json({ error: "Cannot delete the default profile" }, 400, port);
        try {
          const deleted = deleteProfile(name, profile);
          if (!deleted) return json({ error: `Profile '${profile}' not found` }, 404, port);
          logActivity("profile_delete", name, `Deleted profile: ${profile}`);
          return json({ success: true }, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed to delete profile" }, 500, port);
        }
      }

      // ── Export/Import Routes ──

      // GET /api/export — Export all connector credentials (excluding OAuth tokens)
      if (path === "/api/export" && method === "GET") {
        try {
          const connectDir = join(homedir(), ".connectors");
          const result: Record<string, { profiles: Record<string, unknown> }> = {};

          if (existsSync(connectDir)) {
            const entries = readdirSync(connectDir, { withFileTypes: true });
            for (const entry of entries) {
              if (!entry.isDirectory() || !entry.name.startsWith("connect-")) continue;
              const connectorName = entry.name.replace(/^connect-/, "");
              const profilesDir = join(connectDir, entry.name, "profiles");
              if (!existsSync(profilesDir)) continue;

              const profiles: Record<string, unknown> = {};
              const profileEntries = readdirSync(profilesDir, { withFileTypes: true });

              for (const pEntry of profileEntries) {
                // Pattern 1: profiles/<name>.json (flat file)
                if (pEntry.isFile() && pEntry.name.endsWith(".json")) {
                  const profileName = basename(pEntry.name, ".json");
                  try {
                    const config = JSON.parse(readFileSync(join(profilesDir, pEntry.name), "utf-8"));
                    profiles[profileName] = config;
                  } catch { /* skip unreadable */ }
                }
                // Pattern 2: profiles/<name>/config.json (directory)
                if (pEntry.isDirectory()) {
                  const configPath = join(profilesDir, pEntry.name, "config.json");
                  if (existsSync(configPath)) {
                    try {
                      const config = JSON.parse(readFileSync(configPath, "utf-8"));
                      profiles[pEntry.name] = config;
                    } catch { /* skip unreadable */ }
                  }
                }
              }

              if (Object.keys(profiles).length > 0) {
                result[connectorName] = { profiles };
              }
            }
          }

          const exportData = { connectors: result, exportedAt: new Date().toISOString() };
          return new Response(JSON.stringify(exportData, null, 2), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Content-Disposition": `attachment; filename="connectors-backup-${new Date().toISOString().slice(0, 10)}.json"`,
              "Access-Control-Allow-Origin": port ? `http://localhost:${port}` : "*",
              ...SECURITY_HEADERS,
            },
          });
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed to export credentials" }, 500, port);
        }
      }

      // POST /api/import — Import connector credentials from backup JSON
      if (path === "/api/import" && method === "POST") {
        try {
          const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
          if (contentLength > MAX_BODY_SIZE) return json({ error: "Request body too large" }, 413, port);

          const body = (await req.json()) as { connectors: Record<string, { profiles: Record<string, unknown> }> };
          if (!body.connectors || typeof body.connectors !== "object") {
            return json({ error: "Invalid import format: missing 'connectors' object" }, 400, port);
          }

          let imported = 0;
          const connectDir = join(homedir(), ".connectors");

          for (const [connectorName, data] of Object.entries(body.connectors)) {
            if (!isValidConnectorName(connectorName)) continue;
            if (!data.profiles || typeof data.profiles !== "object") continue;

            const connectorDir = join(connectDir, `connect-${connectorName}`);
            const profilesDir = join(connectorDir, "profiles");

            for (const [profileName, config] of Object.entries(data.profiles)) {
              if (!config || typeof config !== "object") continue;

              mkdirSync(profilesDir, { recursive: true });
              const profileFile = join(profilesDir, `${profileName}.json`);
              writeFileSync(profileFile, JSON.stringify(config, null, 2));
              imported++;
            }
          }

          logActivity("credentials_imported", "all", `Imported ${imported} profiles`);
          return json({ success: true, imported }, 200, port);
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "Failed to import credentials" }, 500, port);
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
            `Set up credentials at <code>~/.connectors/connect-${name}/credentials.json</code>`
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
          logActivity("oauth_connected", name);

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
            "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
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
