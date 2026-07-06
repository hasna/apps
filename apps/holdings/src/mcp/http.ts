import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Database } from "bun:sqlite";
import { openDatabase } from "../db/database.js";
import { resolveStorageMode } from "../config.js";
import { authenticateBearer, bearerToken, isApiAuthConfigured } from "../server/auth.js";
import { LOCAL_DEV_PRINCIPAL } from "../server/principal.js";
import type { ApiPrincipal } from "../server/auth.js";
import { buildServer } from "./index.js";

// Shared Streamable HTTP transport (§5.1) with MANDATORY per-caller bearer auth
// (§5.1a). Loopback is not a trust boundary on shared fleet hosts, so /mcp
// requires a valid token unless auth is explicitly disabled in local+loopback dev.

export const DEFAULT_MCP_HTTP_PORT = 8893;
export const MCP_HTTP_NAME = "holdings";

export function isHttpMode(): boolean {
  return process.argv.includes("--http") || process.env["MCP_HTTP"] === "1";
}

export function isStdioMode(): boolean {
  return process.argv.includes("--stdio") || process.env["MCP_STDIO"] === "1";
}

export function getMcpBindHost(): string {
  return process.env["HASNA_HOLDINGS_MCP_BIND_HOST"] ?? process.env["HOLDINGS_MCP_BIND_HOST"] ?? "127.0.0.1";
}

/**
 * FAIL-CLOSED STARTUP THROW (§5.1a). Runs FIRST inside startHttpServer, before
 * Bun.serve binds. A non-loopback bind OR cloud mode with no credentials is a
 * misconfigured/open-intent deploy — surface it at boot instead of coming up and
 * 401'ing every caller. Mirrors the serve tier's assertServeSafety (§5.1a).
 */
export function assertMcpServeSafety(hostname: string): void {
  const loopback = hostname === "127.0.0.1" || hostname === "localhost";
  const cloud = resolveStorageMode() === "cloud";
  if ((!loopback || cloud) && !isApiAuthConfigured()) {
    throw new Error(
      "Refusing to start holdings-mcp: bind=" +
        hostname +
        " mode=" +
        (cloud ? "cloud" : "local") +
        " requires API credentials. Set HASNA_HOLDINGS_API_CREDENTIALS (or HASNA_HOLDINGS_API_KEY). " +
        "Unauthenticated MCP is only allowed on 127.0.0.1 in local mode.",
    );
  }
}

// PER-PEER RATE LIMITER (§5.1a/§5.6): a connection-scoped fixed-window limiter keyed
// on the REAL socket peer, NEVER a client-supplied header, so a bearer-token
// brute-force cannot be spread across spoofed identities.
const mcpRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const MCP_RATE_LIMIT_WINDOW = 60_000;

function mcpRateLimitMax(): number {
  return Number.parseInt(process.env["HASNA_HOLDINGS_MCP_RATE_LIMIT"] || process.env["HOLDINGS_MCP_RATE_LIMIT"] || "120", 10);
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

function authDisabledForLocalDev(bindHost: string): boolean {
  const off = (process.env["HASNA_HOLDINGS_MCP_AUTH"] || process.env["HOLDINGS_MCP_AUTH"])?.toLowerCase() === "off";
  const loopback = bindHost === "127.0.0.1" || bindHost === "localhost" || bindHost === "::1";
  return off && loopback && resolveStorageMode() === "local";
}

/** Authenticate an MCP HTTP request. Returns a principal or null (=> 401). */
export function authenticateMcpRequest(req: Request, bindHost = "127.0.0.1"): ApiPrincipal | null {
  const token = bearerToken(req.headers.get("Authorization"));
  if (token) return authenticateBearer(token);
  if (authDisabledForLocalDev(bindHost) && !isApiAuthConfigured()) return LOCAL_DEV_PRINCIPAL;
  return null;
}

export function healthResponse(name = MCP_HTTP_NAME): Response {
  return Response.json({ status: "ok", name });
}

export async function handleMcpHttpRequest(req: Request, db: Database, principal: ApiPrincipal): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = buildServer({ db, principal });
  await server.connect(transport);
  return transport.handleRequest(req);
}

export function startHttpServer(port: number, options?: { db?: Database; bindHost?: string }): ReturnType<typeof Bun.serve> {
  const bindHost = options?.bindHost ?? getMcpBindHost();
  assertMcpServeSafety(bindHost);
  const db = options?.db ?? openDatabase();

  const server = Bun.serve({
    hostname: bindHost,
    port,
    async fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/health" && req.method === "GET") {
        return healthResponse();
      }
      if (url.pathname === "/mcp") {
        const peer = srv.requestIP(req)?.address ?? "conn";
        if (!checkMcpRateLimit(peer)) {
          return Response.json(
            { code: "RATE_LIMITED", message: "Too many requests", suggestion: "Slow down and retry." },
            { status: 429 },
          );
        }
        const principal = authenticateMcpRequest(req, bindHost);
        if (!principal) {
          return Response.json(
            { code: "UNAUTHORIZED", message: "Invalid or missing bearer token on /mcp.", suggestion: "Provide Authorization: Bearer <token>." },
            { status: 401 },
          );
        }
        return handleMcpHttpRequest(req, db, principal);
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    },
  });

  console.error(`holdings-mcp HTTP listening on http://${bindHost}:${port}/mcp`);
  return server;
}
