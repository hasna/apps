import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { authenticateToken, bearerToken, isApiAuthConfigured, type ApiPrincipal } from "../server/auth.js";
import { resolveStorageMode } from "../config.js";
import { buildServer, localOwnerPrincipal } from "./index.js";

export const DEFAULT_MCP_HTTP_PORT = 8890; // treasury pinned MCP HTTP port (§5.3)
export const MCP_HTTP_NAME = "treasury";

/**
 * Bind host for the MCP HTTP transport. Defaults to loopback; a container/self-host
 * deploy sets HASNA_TREASURY_MCP_BIND_HOST=0.0.0.0 so the published port is
 * reachable. A non-loopback bind forces auth on and is asserted fail-closed at
 * startup (see assertMcpServeSafety).
 */
export function resolveBindHost(): string {
  return process.env["HASNA_TREASURY_MCP_BIND_HOST"] || process.env["TREASURY_MCP_BIND_HOST"] || "127.0.0.1";
}

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

export function healthResponse(name = MCP_HTTP_NAME): Response {
  return Response.json({ status: "ok", name });
}

// Connection-scoped rate limit for the unauthenticated /mcp surface. Keyed on the
// real socket peer (never a client-supplied header), so a bearer-token brute-force
// cannot be spread across spoofed identities.
const mcpRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const MCP_RATE_LIMIT_WINDOW = 60_000;

function mcpRateLimitMax(): number {
  return Number.parseInt(process.env["HASNA_TREASURY_MCP_RATE_LIMIT"] || process.env["TREASURY_MCP_RATE_LIMIT"] || "120", 10);
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

/** Auth disabled only when explicitly off AND loopback AND local mode (fail-closed). */
export function mcpAuthDisabled(hostname: string): boolean {
  const off = (process.env["HASNA_TREASURY_MCP_AUTH"] || process.env["TREASURY_MCP_AUTH"] || "").toLowerCase() === "off";
  const loopback = hostname === "127.0.0.1" || hostname === "localhost";
  return off && loopback && resolveStorageMode() === "local";
}

/**
 * Authenticate an /mcp request to a caller principal. Bearer required unless
 * auth is explicitly disabled for local loopback dev (§5.1a).
 */
export function authenticateMcp(req: Request, hostname: string): ApiPrincipal | null {
  if (mcpAuthDisabled(hostname)) return localOwnerPrincipal();
  const token = bearerToken(req.headers.get("Authorization"));
  if (!token) return null;
  return authenticateToken(token);
}

export async function handleMcpHttpRequest(
  req: Request,
  hostname: string,
  createServer: (principal: ApiPrincipal) => McpServer = buildServer,
): Promise<Response> {
  const principal = authenticateMcp(req, hostname);
  if (!principal) {
    return Response.json(
      { code: "UNAUTHORIZED", message: "Invalid or missing Bearer credential.", suggestion: "Provide a valid Bearer token." },
      { status: 401 },
    );
  }
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = createServer(principal);
  await server.connect(transport);
  return transport.handleRequest(req);
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
      `Refusing to start treasury-mcp: bind=${hostname} mode=${cloud ? "cloud" : "local"} requires API credentials. ` +
        `Set HASNA_TREASURY_API_CREDENTIALS (or HASNA_TREASURY_API_KEY). ` +
        `Unauthenticated MCP is only allowed on 127.0.0.1 in local mode.`,
    );
  }
}

export async function startHttpServer(
  port: number,
  options?: { name?: string; hostname?: string },
): Promise<ReturnType<typeof Bun.serve>> {
  const name = options?.name ?? MCP_HTTP_NAME;
  const hostname = options?.hostname ?? resolveBindHost();
  assertMcpServeSafety(hostname);
  const server = Bun.serve({
    hostname,
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
        return handleMcpHttpRequest(req, hostname);
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    },
  });
  console.error(`treasury-mcp HTTP listening on http://${hostname}:${port}/mcp`);
  return server;
}
