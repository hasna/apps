import { handleMcpFetch } from "../mcp/http.js";
import { getPackageVersion } from "./version.js";
import { buildV1OpenApiDocument } from "./openapi.js";
import { handleV1Request } from "./v1.js";
import { hasHostedDatabase, pingCloud, resolveBackend, closeCloud } from "./cloud.js";
import {
  authorizeLocalPlane,
  describeAuthPosture,
  isAnonymousOptInEnv,
  resolveAuthPosture,
  resolveServeCredential,
  type AuthPosture,
} from "./auth-posture.js";
import { resolveClientTransport } from "../store/http-storage.js";
import { getStore } from "../store/index.js";

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export interface ServeOptions {
  host?: string;
  /** Serve credential for the local `/mcp` plane (`--api-key`). */
  apiKey?: string | null;
  /** Explicit `--allow-anonymous` opt-in (loopback binds only). */
  allowAnonymous?: boolean;
}

/**
 * ROUTE CENSUS — every route this server mounts, and its guard.
 * (Enumerated from the router below, not from memory: the original defect was a
 * route nobody thought about, so an incomplete census reproduces the bug.)
 *
 *  #  path                       methods                       auth                      store reached                  carries
 *  1  /health                    GET                           public (ALB health check) none                           metadata
 *  2  /version                   GET                           public                    none                           metadata
 *  3  /ready                     GET                           public (ALB/ECS probe)    getClient() `select 1` only    metadata
 *  4  /openapi.json              GET                           public                    none                           metadata
 *  5  /v1                        any                           contracts API-key         none (banner)                  metadata
 *  6  /v1/orgs[/:id]             GET POST PATCH PUT DELETE     contracts API-key         getCloudStore -> RDS           DATA
 *  7  /v1/calendars[/:id]        GET POST PATCH PUT DELETE     contracts API-key         getCloudStore -> RDS           DATA
 *  8  /v1/events[/:id|search|conflicts]
 *                                GET POST PATCH PUT DELETE     contracts API-key         getCloudStore -> RDS           DATA
 *  9  /v1/attendees[/:id]        GET POST PATCH PUT DELETE     contracts API-key         getCloudStore -> RDS           DATA
 * 10  /v1/agents[/:id[/heartbeat]]
 *                                GET POST PATCH PUT DELETE     contracts API-key         getCloudStore -> RDS           DATA
 * 11  /v1/availability[/:id]     GET POST DELETE               contracts API-key         getCloudStore -> RDS           DATA
 * 12  /v1/members                GET POST DELETE               contracts API-key         getCloudStore -> RDS           DATA
 * 13  /v1/<unknown>              any                           contracts API-key         none                           metadata (404)
 * 14  /mcp                       POST GET DELETE (+OPTIONS)    WAS: NONE  <-- the defect  getStore() x23 tools           DATA (read+write)
 *                                                              NOW: auth posture
 * 15  OPTIONS <non-/v1, non-/mcp> OPTIONS                      public                    none                           metadata (CORS)
 * 16  everything else            any                           public                    none                           metadata (404)
 *
 * Route 14 is the only route whose guard changes. Routes 1-4 MUST stay public:
 * the ALB target group health-checks `/health` (matcher 200) and ECS cycles the
 * task if it stops answering.
 *
 * Known pre-existing quirks, unchanged here — both CORS-preflight-only:
 *   - `OPTIONS /v1/...` is claimed by route 5-13 (path prefix match) and treated
 *     as a write, so it 401s rather than returning CORS headers.
 *   - `OPTIONS /mcp` is claimed by route 14 below (it matches on path, not
 *     method) and so goes through the auth posture: 401 under `enforce`, 404
 *     `LOCAL_PLANE_DISABLED` when the local plane is off. It never reaches the
 *     route-15 CORS handler either.
 * Net effect: only paths that are neither `/v1*` nor `/mcp` get a real CORS
 * preflight. Both data surfaces are server-to-server today, so this is
 * documented, not fixed in this hotfix.
 */
export function serve(port: number, options: ServeOptions = {}) {
  const hostname = options.host || process.env["CALENDAR_HOST"] || process.env["HOST"] || "127.0.0.1";
  const backend = resolveBackend();
  const hosted = hasHostedDatabase();

  // Resolved ONCE, before the socket is bound. Throws AuthNotConfiguredError
  // rather than binding a port that would serve /mcp anonymously off-box.
  const posture: AuthPosture = resolveAuthPosture({
    credential: options.apiKey ?? resolveServeCredential(),
    host: hostname,
    allowAnonymous: options.allowAnonymous ?? isAnonymousOptInEnv(),
    hosted,
    // What getStore() — and therefore every MCP tool — will actually talk to.
    localPlaneTransport: resolveClientTransport("calendar").transport === "http-api"
      ? "http-api"
      : "local",
  });

  // A mounted MCP plane is a domain client and must validate its own HTTPS
  // authority before binding. Disabled MCP does not require client credentials.
  if (posture.mode !== "local-plane-disabled") getStore();

  const server = Bun.serve({
    port,
    hostname,
    idleTimeout: 60,
    async fetch(req: Request, self: { requestIP(req: Request): { address: string } | null }): Promise<Response> {
      const url = new URL(req.url);
      const path = url.pathname;

      // ── [1-4] Service contract probes: PUBLIC, metadata only ──────────────
      // Handled before every guard so the ALB target group and any container
      // healthcheck keep answering 200 in every posture.
      if (path === "/health" && req.method === "GET") {
        return json({ status: "ok", version: getPackageVersion(), backend });
      }
      if (path === "/version" && req.method === "GET") {
        return json({ name: "calendar", version: getPackageVersion(), backend });
      }
      if (path === "/ready" && req.method === "GET") {
        try {
          const ok = await pingCloud();
          return ok
            ? json({ status: "ready", backend, checks: { database: "ok" } })
            : json({ status: "not_ready", backend, checks: { database: "unreachable" } }, 503);
        } catch (e) {
          return json({ status: "not_ready", backend, checks: { database: "unreachable" } }, 503);
        }
      }
      if (path === "/openapi.json" && req.method === "GET") {
        return json(buildV1OpenApiDocument());
      }

      // ── [5-13] Versioned /v1 API (pure-remote, contracts API-key auth) ────
      const v1 = await handleV1Request(req, url);
      if (v1) return v1;

      // ── [14] MCP Streamable HTTP — DATA PLANE, guarded ────────────────────
      // This mount used to sit outside every auth check (handleV1Request returns
      // null for non-/v1 paths), publishing 23 read/write tools anonymously.
      if (path === "/mcp") {
        const decision = authorizeLocalPlane(posture, req.headers, self.requestIP(req)?.address);
        if (!decision.allow) {
          return json(decision.body, decision.status);
        }
        return handleMcpFetch(req);
      }

      // ── [15] CORS preflight ───────────────────────────────────────────────
      if (req.method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key, Idempotency-Key",
          },
        });
      }

      // ── [16] 404 ──────────────────────────────────────────────────────────
      return new Response("Not found", { status: 404 });
    },
  });

  console.log(`Calendar server listening on http://${hostname}:${port} (backend=${backend})`);
  console.log(describeAuthPosture(posture));

  // Graceful shutdown
  process.on("SIGINT", () => {
    void closeCloud();
    server.stop();
    process.exit(0);
  });

  return server;
}
