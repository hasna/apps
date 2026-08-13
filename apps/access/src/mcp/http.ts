import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildServer } from "./index.js";
import { authenticateApiRequest, isApiAuthConfigured, principalToContext } from "../server/auth.js";
import { SYSTEM_AUTHORIZATION_CONTEXT } from "../services/authorization.js";
import type { AuthorizationContext } from "../services/authorization-scopes.js";
import { resolveStorageMode } from "../config.js";
import { assertTokenSigningPosture } from "../services/tokens.js";

/**
 * Streamable HTTP transport for the access MCP server, with MANDATORY per-caller
 * bearer auth (§5.1a). Every /mcp request must present a valid bearer token,
 * resolved through the SAME `authenticateApiRequest` path as the /v1 serve tier
 * (a serve credential OR an access-issued token, verified timing-safe) — the
 * token's scopes/entity_ids are the sole authority. Auth may be disabled ONLY in
 * local mode bound to loopback.
 */

export const DEFAULT_MCP_HTTP_PORT = 8887;
export const MCP_HTTP_NAME = "access";

export function isHttpMode(): boolean {
  return process.argv.includes("--http") || process.env["MCP_HTTP"] === "1";
}

export function isStdioMode(): boolean {
  return process.argv.includes("--stdio") || process.env["MCP_STDIO"] === "1";
}

export function resolveHttpPort(defaultPort = DEFAULT_MCP_HTTP_PORT): number {
  const portFlag = process.argv.find((arg) => arg === "--port" || arg.startsWith("--port="));
  if (portFlag) {
    if (portFlag.includes("=")) {
      const parsed = Number.parseInt(portFlag.split("=")[1] ?? "", 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    } else {
      const idx = process.argv.indexOf(portFlag);
      const parsed = Number.parseInt(process.argv[idx + 1] ?? "", 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  const envPort = Number.parseInt(process.env["MCP_HTTP_PORT"] ?? "", 10);
  if (Number.isFinite(envPort) && envPort > 0) return envPort;
  return defaultPort;
}

/** The MCP HTTP bind host; a non-loopback bind (e.g. 0.0.0.0 in Docker) forces auth on. */
export function resolveMcpBindHost(): string {
  return process.env["HASNA_ACCESS_MCP_BIND_HOST"] || process.env["ACCESS_MCP_BIND_HOST"] || "127.0.0.1";
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

/** Auth is disabled ONLY when explicitly off AND on a loopback bind AND local mode. */
export function mcpAuthDisabled(host = "127.0.0.1"): boolean {
  const off = (process.env["HASNA_ACCESS_MCP_AUTH"] || process.env["ACCESS_MCP_AUTH"] || "").toLowerCase() === "off";
  return off && isLoopback(host) && resolveStorageMode() === "local";
}

/** Kept for backwards-compatible call sites; auth is on unless explicitly disabled. */
export function mcpAuthEnabled(host = "127.0.0.1"): boolean {
  return !mcpAuthDisabled(host);
}

/**
 * FAIL-CLOSED STARTUP THROW (§5.1a, mirrors the serve tier's assertAuthPosture).
 * Refuses to start when the transport would be exposed without credentials: a
 * non-loopback bind OR cloud mode with no API credentials is a misconfigured /
 * open-intent deploy, so it surfaces the misconfig at boot instead of coming up
 * "successfully" and 401'ing every caller.
 */
export function assertMcpServeSafety(hostname: string): void {
  const loopback = isLoopback(hostname);
  const mode = resolveStorageMode();
  const cloud = mode === "cloud";
  if ((!loopback || cloud) && !isApiAuthConfigured()) {
    throw new Error(
      `Refusing to start access-mcp: bind=${hostname} mode=${cloud ? "cloud" : "local"} requires API credentials. ` +
        "Set HASNA_ACCESS_API_CREDENTIALS (or HASNA_ACCESS_API_KEY). Unauthenticated MCP is only allowed on 127.0.0.1 in local mode.",
    );
  }
  assertTokenSigningPosture({ mode, exposed: !loopback });
}

// PER-PEER RATE LIMITER (§5.1a). Connection-scoped fixed-window limiter keyed on
// the REAL socket peer (never a client-supplied header), so a bearer-token
// brute-force cannot be spread across spoofed identities.
const mcpRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const MCP_RATE_LIMIT_WINDOW = 60_000;
function mcpRateLimitMax(): number {
  return Number.parseInt(process.env["HASNA_ACCESS_MCP_RATE_LIMIT"] || process.env["ACCESS_MCP_RATE_LIMIT"] || "120", 10);
}
export function checkMcpRateLimit(key: string): boolean {
  const now = Date.now();
  const e = mcpRateLimitMap.get(key);
  if (!e || now > e.resetAt) {
    mcpRateLimitMap.set(key, { count: 1, resetAt: now + MCP_RATE_LIMIT_WINDOW });
    return true;
  }
  e.count++;
  return e.count <= mcpRateLimitMax();
}
export function resetMcpRateLimit(): void {
  mcpRateLimitMap.clear();
}

export interface McpAuthOutcome {
  ok: boolean;
  status?: number;
  message?: string;
  /**
   * The caller's derived AuthorizationContext (scopes + entity/org scope), threaded
   * into the MCP tools so domain ops enforce the SAME per-caller authorization as
   * the /v1 routes (§5.1a). Present only when ok. When auth is disabled (local-dev
   * loopback) this is the system context.
   */
  context?: AuthorizationContext;
}

/**
 * Verify a presented bearer token via the shared `authenticateApiRequest` path
 * AND derive the caller's scoped AuthorizationContext. The context — not a bypass
 * system context — is what the tools run under, so a token narrowed to read-only
 * on a single entity cannot perform cross-entity reads or un-scoped writes.
 */
export function authorizeMcpRequest(req: Request, host = "127.0.0.1"): McpAuthOutcome {
  // Local-dev auth-off (loopback + local mode only): full system context.
  if (mcpAuthDisabled(host)) return { ok: true, context: SYSTEM_AUTHORIZATION_CONTEXT };
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ") || auth.slice(7).trim() === "") {
    return { ok: false, status: 401, message: "Missing bearer token." };
  }
  // The identical credential set honored by /v1: a serve credential OR an
  // access-issued token. The resulting principal's scopes/entity_ids are the
  // sole authority for the tools it dispatches.
  const principal = authenticateApiRequest(req);
  if (!principal) {
    return { ok: false, status: 401, message: "Invalid or unrecognized bearer token." };
  }
  return { ok: true, context: principalToContext(principal) };
}

export function healthResponse(name = MCP_HTTP_NAME): Response {
  return Response.json({ status: "ok", name });
}

export async function handleMcpHttpRequest(
  req: Request,
  context: AuthorizationContext = SYSTEM_AUTHORIZATION_CONTEXT,
  createServer: (ctx: AuthorizationContext) => McpServer = buildServer,
): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  // A fresh server is built per request wired to THIS caller's authorization
  // context, so every tool dispatch runs under the caller's scopes/entities.
  const server = createServer(context);
  await server.connect(transport);
  return transport.handleRequest(req);
}

export async function startHttpServer(
  port: number,
  options?: { createServer?: (ctx: AuthorizationContext) => McpServer; name?: string; host?: string },
): Promise<ReturnType<typeof Bun.serve>> {
  const createServer = options?.createServer ?? buildServer;
  const name = options?.name ?? MCP_HTTP_NAME;
  const host = options?.host ?? resolveMcpBindHost();
  // Fail-closed BEFORE Bun.serve binds: refuse an exposed unauthenticated transport.
  assertMcpServeSafety(host);

  const server = Bun.serve({
    hostname: host,
    port,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/health" && req.method === "GET") return healthResponse(name);
      if (url.pathname === "/mcp") {
        const peer = server.requestIP(req)?.address ?? "conn";
        if (!checkMcpRateLimit(peer)) {
          return Response.json(
            { code: "RATE_LIMITED", message: "Too many requests", suggestion: "Slow down and retry." },
            { status: 429 },
          );
        }
        const outcome = authorizeMcpRequest(req, host);
        if (!outcome.ok) {
          return Response.json({ error: outcome.message ?? "Unauthorized" }, { status: outcome.status ?? 401 });
        }
        return handleMcpHttpRequest(req, outcome.context ?? SYSTEM_AUTHORIZATION_CONTEXT, createServer);
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    },
  });
  console.error(`access-mcp HTTP listening on http://${host}:${port}/mcp (auth ${mcpAuthDisabled(host) ? "off" : "on"})`);
  return server;
}
