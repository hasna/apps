import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { resolveStorageMode } from "../config.js";
import { SYSTEM_AUTHORIZATION_CONTEXT } from "../services/authorization.js";
import { authenticateApiRequest, isApiAuthConfigured, toAuthorizationContext } from "../server/auth.js";
import { buildServer } from "./index.js";

export const DEFAULT_MCP_HTTP_PORT = 8888;
export const MCP_HTTP_NAME = "workforce";

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

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

/**
 * The MCP HTTP bind host. Defaults to loopback; Docker/cloud deploys set
 * HASNA_WORKFORCE_MCP_BIND_HOST=0.0.0.0 so the published port is reachable. A
 * non-loopback bind forces auth on and is asserted fail-closed at startup.
 */
export function resolveMcpBindHost(): string {
  return process.env["HASNA_WORKFORCE_MCP_BIND_HOST"] || process.env["WORKFORCE_MCP_BIND_HOST"] || "127.0.0.1";
}

/**
 * FAIL-CLOSED STARTUP THROW. Runs FIRST inside startHttpServer, before Bun.serve
 * binds. Refuses to start when the transport would be exposed without credentials
 * (a non-loopback bind OR cloud mode). Mirrors the serve tier's assertServeSafety.
 */
export function assertMcpServeSafety(hostname: string): void {
  const loopback = hostname === "127.0.0.1" || hostname === "localhost";
  const cloud = (() => {
    try {
      return resolveStorageMode() === "cloud";
    } catch {
      return false;
    }
  })();
  if ((!loopback || cloud) && !isApiAuthConfigured()) {
    throw new Error(
      `Refusing to start workforce-mcp: bind=${hostname} mode=${cloud ? "cloud" : "local"} requires API credentials. ` +
        "Set HASNA_WORKFORCE_API_CREDENTIALS (or HASNA_WORKFORCE_API_KEY). " +
        "Unauthenticated MCP is only allowed on 127.0.0.1 in local mode.",
    );
  }
}

// ── Per-peer rate limiter ───────────────────────────────────────────────────
// Connection-scoped fixed-window limiter keyed on the REAL socket peer (never a
// client-supplied header), so a bearer-token brute-force cannot be spread across
// spoofed identities.
const mcpRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const MCP_RATE_LIMIT_WINDOW = 60_000;

function mcpRateLimitMax(): number {
  return Number.parseInt(
    process.env["HASNA_WORKFORCE_MCP_RATE_LIMIT"] || process.env["WORKFORCE_MCP_RATE_LIMIT"] || "120",
    10,
  );
}

export function checkMcpRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = mcpRateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    mcpRateLimitMap.set(key, { count: 1, resetAt: now + MCP_RATE_LIMIT_WINDOW });
    return true;
  }
  entry.count++;
  return entry.count <= mcpRateLimitMax();
}

export function resetMcpRateLimit(): void {
  mcpRateLimitMap.clear();
}

/**
 * MCP auth is decoupled from convenience: it may only be disabled with
 * HASNA_WORKFORCE_MCP_AUTH=off AND a loopback bind AND local mode. Any
 * non-loopback bind or cloud mode forces auth on (fail-closed).
 */
export function mcpAuthRequired(host: string): boolean {
  const off = (process.env["HASNA_WORKFORCE_MCP_AUTH"] || "").toLowerCase() === "off";
  let cloud = false;
  try {
    cloud = resolveStorageMode() === "cloud";
  } catch {
    cloud = false;
  }
  if (!isLoopback(host) || cloud) return true;
  if (off) return false;
  return true;
}

export function unauthorizedResponse(): Response {
  return Response.json(
    { code: "UNAUTHORIZED", message: "Invalid or missing MCP bearer token.", suggestion: "Send Authorization: Bearer <token>." },
    { status: 401 },
  );
}

/** Authenticate the caller and dispatch the MCP request with the caller's authorization context. */
export async function handleMcpHttpRequest(req: Request, host: string): Promise<Response> {
  const required = mcpAuthRequired(host);
  let authCtx = SYSTEM_AUTHORIZATION_CONTEXT;
  if (required) {
    if (!isApiAuthConfigured()) return unauthorizedResponse();
    const principal = authenticateApiRequest(req);
    if (!principal) return unauthorizedResponse();
    authCtx = toAuthorizationContext(principal);
  }
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const server = buildServer(authCtx);
  await server.connect(transport);
  return transport.handleRequest(req);
}

export function healthResponse(name = MCP_HTTP_NAME): Response {
  return Response.json({ status: "ok", name });
}

export async function startHttpServer(port: number): Promise<ReturnType<typeof Bun.serve>> {
  const hostname = resolveMcpBindHost();
  // Fail closed BEFORE binding: an exposed transport with no credentials never starts.
  assertMcpServeSafety(hostname);
  const server = Bun.serve({
    hostname,
    port,
    async fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/health" && req.method === "GET") return healthResponse();
      if (url.pathname === "/mcp") {
        // Rate-limit on the REAL socket peer, never a spoofable header.
        const peer = srv.requestIP(req)?.address ?? "conn";
        if (!checkMcpRateLimit(peer)) {
          return Response.json({ code: "RATE_LIMITED", message: "Too many requests", suggestion: "Slow down and retry." }, { status: 429 });
        }
        return handleMcpHttpRequest(req, hostname);
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    },
  });
  console.error(`workforce-mcp HTTP listening on http://${hostname}:${port}/mcp (auth ${mcpAuthRequired(hostname) ? "on" : "off"})`);
  return server;
}
