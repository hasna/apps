import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveStorageMode } from "../config.js";
import { authenticateToken, bearerFromHeader, isApiAuthConfigured, type ApiPrincipal } from "../server/auth.js";
import { buildServer } from "./index.js";

/**
 * Streamable HTTP transport for the billing MCP server WITH per-caller bearer
 * auth (BUILD-SPEC §5.1a). Modeled on open-todos but auth is added because
 * loopback is NOT a trust boundary on shared fleet hosts. The authenticated
 * caller principal (scopes + entity_ids) is threaded into buildServer so domain
 * tools enforce the SAME authorization as /v1 — never a SYSTEM bypass
 * (failure class 1).
 */
export const DEFAULT_MCP_HTTP_PORT = 8891;
export const MCP_HTTP_NAME = "billing";

export function isHttpMode(): boolean {
  return process.argv.includes("--http") || process.env["MCP_HTTP"] === "1";
}

export function isStdioMode(): boolean {
  return process.argv.includes("--stdio") || process.env["MCP_STDIO"] === "1";
}

/**
 * Resolve the MCP HTTP bind host, mirroring the serve tier's getBindHost
 * (BUILD-SPEC §6.1). Defaults to loopback; set 0.0.0.0 for the container/self-
 * host artifact so the published port is reachable. Auth stays fail-closed on
 * any non-loopback bind (mcpAuthRequired), so binding wide remains safe.
 */
export function resolveBindHost(): string {
  return process.env["HASNA_BILLING_MCP_BIND_HOST"] || process.env["BILLING_MCP_BIND_HOST"] || "127.0.0.1";
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

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

/**
 * Fail-closed MCP auth (§5.1a): a bearer token is required on every /mcp
 * request unless HASNA_BILLING_MCP_AUTH=off AND bound to loopback in local mode.
 */
export function mcpAuthRequired(host: string): boolean {
  const off = (process.env["HASNA_BILLING_MCP_AUTH"] || process.env["BILLING_MCP_AUTH"]) === "off";
  if (off && isLoopbackHost(host) && resolveStorageMode() === "local") return false;
  return true;
}

export function healthResponse(name = MCP_HTTP_NAME): Response {
  return Response.json({ status: "ok", name });
}

// Connection-scoped rate limit for the /mcp surface. Keyed on the REAL socket peer
// (srv.requestIP), NEVER a client-supplied header, so a bearer-token brute-force
// cannot be spread across spoofed identities (BUILD-SPEC §5.1a).
const mcpRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const MCP_RATE_LIMIT_WINDOW = 60_000;

function mcpRateLimitMax(): number {
  return Number.parseInt(process.env["HASNA_BILLING_MCP_RATE_LIMIT"] || process.env["BILLING_MCP_RATE_LIMIT"] || "120", 10);
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
 * Fail-closed startup assertion for the MCP HTTP transport, mirroring the serve
 * tier's assertServeSafety (BUILD-SPEC §5.1a). A non-loopback bind OR cloud mode
 * with no API credentials configured is almost certainly a misconfigured /
 * open-intent deploy. Refuse to start and surface the misconfig instead of
 * silently coming up "successfully" and 401'ing every caller at request time.
 */
export function assertMcpServeSafety(hostname: string): void {
  const loopback = hostname === "127.0.0.1" || hostname === "localhost";
  const cloud = resolveStorageMode() === "cloud";
  if ((!loopback || cloud) && !isApiAuthConfigured()) {
    throw new Error(
      `Refusing to start billing-mcp: bind=${hostname} mode=${cloud ? "cloud" : "local"} requires API credentials. ` +
        `Set HASNA_BILLING_API_CREDENTIALS (or HASNA_BILLING_API_KEY). ` +
        `Unauthenticated MCP is only allowed on 127.0.0.1 in local mode.`,
    );
  }
}

export async function handleMcpHttpRequest(
  req: Request,
  opts: { host: string; createServer?: (principal?: ApiPrincipal) => McpServer } = { host: "127.0.0.1" },
): Promise<Response> {
  let principal: ApiPrincipal | undefined;
  if (mcpAuthRequired(opts.host)) {
    const token = bearerFromHeader(req.headers.get("Authorization"));
    const authed = authenticateToken(token);
    if (!authed) {
      return Response.json(
        { code: "UNAUTHORIZED", message: "Invalid or missing MCP bearer token.", suggestion: "Send Authorization: Bearer <token>." },
        { status: 401 },
      );
    }
    principal = authed;
  }

  const create = opts.createServer ?? ((p?: ApiPrincipal) => buildServer(p ? { principal: p } : undefined));
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = create(principal);
  await server.connect(transport);
  return transport.handleRequest(req);
}

export async function startHttpServer(
  port: number,
  options?: { host?: string; name?: string },
): Promise<ReturnType<typeof Bun.serve>> {
  const host = options?.host ?? resolveBindHost();
  const name = options?.name ?? MCP_HTTP_NAME;
  assertMcpServeSafety(host);

  const server = Bun.serve({
    hostname: host,
    port,
    async fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/health" && req.method === "GET") return healthResponse(name);
      if (url.pathname === "/mcp") {
        const peer = srv.requestIP(req)?.address ?? "conn";
        if (!checkMcpRateLimit(peer)) {
          return Response.json(
            { code: "RATE_LIMITED", message: "Too many requests", suggestion: "Slow down and retry." },
            { status: 429 },
          );
        }
        return handleMcpHttpRequest(req, { host });
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    },
  });

  console.error(`billing-mcp HTTP listening on http://${host}:${port}/mcp (auth ${mcpAuthRequired(host) ? "required" : "off"})`);
  return server;
}
