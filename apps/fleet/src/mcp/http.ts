import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildServer } from "./index.js";
import { authenticateToken, bearerToken, localOwnerPrincipal, type ApiPrincipal } from "../server/auth.js";
import { health } from "../server/health.js";

export const DEFAULT_MCP_HTTP_PORT = 8889;
export const MCP_HTTP_NAME = "fleet";

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
  // Minimal, unauthenticated health on the MCP port.
  return Response.json({ status: "ok", name });
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

/**
 * Whether per-caller bearer auth is required on /mcp (§5.1a). Auth may be turned
 * off ONLY when bound to loopback in local mode; any non-loopback bind or cloud
 * mode forces auth on (fail-closed).
 */
export function mcpAuthRequired(bindHost: string): boolean {
  const authOff = (process.env["HASNA_FLEET_MCP_AUTH"] || process.env["FLEET_MCP_AUTH"])?.toLowerCase() === "off";
  const local = health().mode === "local";
  if (authOff && isLoopback(bindHost) && local) return false;
  return true;
}

export async function handleMcpHttpRequest(
  req: Request,
  principal: ApiPrincipal,
): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server: McpServer = buildServer(principal);
  await server.connect(transport);
  return transport.handleRequest(req);
}

export async function startHttpServer(
  port: number,
  options?: { name?: string; hostname?: string },
): Promise<ReturnType<typeof Bun.serve>> {
  const name = options?.name ?? MCP_HTTP_NAME;
  const hostname = options?.hostname ?? "127.0.0.1";
  const requireAuth = mcpAuthRequired(hostname);

  const server = Bun.serve({
    hostname,
    port,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/health" && req.method === "GET") return healthResponse(name);
      if (url.pathname !== "/mcp") return Response.json({ error: "Not found" }, { status: 404 });

      // §5.1a: bearer auth on every /mcp request (timing-safe via authenticateToken).
      const principal = authenticateToken(bearerToken(req));
      if (requireAuth) {
        if (!principal) {
          return Response.json(
            { code: "UNAUTHORIZED", message: "Invalid or missing bearer credential on /mcp.", suggestion: "Send Authorization: Bearer <token>." },
            { status: 401 },
          );
        }
        return handleMcpHttpRequest(req, principal);
      }
      return handleMcpHttpRequest(req, principal ?? localOwnerPrincipal());
    },
  });

  console.error(`fleet-mcp HTTP listening on http://${hostname}:${port}/mcp (auth ${requireAuth ? "on" : "off"})`);
  return server;
}
