import { handleMcpFetch } from "../mcp/http.js";
import { closeDatabase } from "../db/database.js";
import { getPackageVersion } from "./version.js";
import { buildV1OpenApiDocument } from "./openapi.js";
import { handleV1Request } from "./v1.js";
import { isCloudModeEnabled, pingCloud } from "./cloud.js";

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export interface ServeOptions {
  host?: string;
}

/**
 * The calendar HTTP surface. It serves ONLY:
 *   - service-contract probes (/health, /ready, /version, /openapi.json),
 *   - the versioned, API-key-authed `/v1` data API (RDS-backed in cloud mode),
 *   - the MCP Streamable-HTTP endpoint (/mcp).
 *
 * There is no unauthenticated REST surface: all data access goes through `/v1`
 * (auth + the same store the CLI/MCP use), so the process can never read a stale
 * on-box SQLite island while claiming to be the shared cloud.
 */
export function serve(port: number, options: ServeOptions = {}) {
  const hostname = options.host || process.env["CALENDAR_HOST"] || process.env["HOST"] || "127.0.0.1";
  const mode = isCloudModeEnabled() ? "remote" : "local";

  const server = Bun.serve({
    port,
    hostname,
    idleTimeout: 60,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const path = url.pathname;

      // ── Service contract endpoints (health / ready / version / openapi) ──
      if (path === "/health" && req.method === "GET") {
        return json({ status: "ok", version: getPackageVersion(), mode });
      }
      if (path === "/version" && req.method === "GET") {
        return json({ name: "calendar", version: getPackageVersion(), mode });
      }
      if (path === "/ready" && req.method === "GET") {
        if (mode !== "remote") {
          return json({ status: "ready", mode, checks: { database: "local" } });
        }
        try {
          const ok = await pingCloud();
          return ok
            ? json({ status: "ready", mode, checks: { database: "ok" } })
            : json({ status: "not_ready", mode, checks: { database: "unreachable" } }, 503);
        } catch (e) {
          return json({ status: "not_ready", mode, checks: { database: (e as Error).message } }, 503);
        }
      }
      if (path === "/openapi.json" && req.method === "GET") {
        return json(buildV1OpenApiDocument());
      }

      // ── Versioned /v1 API (A1 pure-remote, API-key auth) ──────────────────
      const v1 = await handleV1Request(req, url);
      if (v1) return v1;

      // ── MCP Streamable HTTP (shared long-lived server) ─────────────────
      if (path === "/mcp") {
        return handleMcpFetch(req);
      }

      // ── CORS preflight ────────────────────────────────────────────────────
      if (req.method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key, Idempotency-Key",
          },
        });
      }

      // ── 404 ───────────────────────────────────────────────────────────────
      return new Response("Not found", { status: 404 });
    },
  });

  console.log(`Calendar server listening on http://${hostname}:${port} (mode=${mode})`);

  // Graceful shutdown
  process.on("SIGINT", () => {
    closeDatabase();
    server.stop();
    process.exit(0);
  });

  return server;
}
