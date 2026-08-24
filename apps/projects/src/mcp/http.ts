import { createHash, timingSafeEqual } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

/**
 * projects MCP transport/port boilerplate.
 * Keep this local and dependency-free so the published CLI can build without
 * an unpublished workspace-only MCP harness package.
 */

export const MCP_HTTP_HOST = "127.0.0.1";
export const DEFAULT_MCP_HTTP_PORT = 8871;

// The bearer value served from the PROJECTS_MCP_TOKEN environment contract.
// Default-off: when unset, the MCP endpoint stays loopback-only (with DNS
// rebinding protection always on); when set, every HTTP route requires
// `Authorization: Bearer <token>`.
const MCP_BEARER = process.env["PROJECTS_MCP_TOKEN"] || "";

export function mcpTokenConfigured(): boolean {
  return MCP_BEARER.length > 0;
}

function bearerMatches(authorizationHeader: string): boolean {
  const provided = authorizationHeader.startsWith("Bearer ")
    ? authorizationHeader.slice("Bearer ".length)
    : "";
  const expectedDigest = createHash("sha256").update(MCP_BEARER).digest();
  const providedDigest = createHash("sha256").update(provided).digest();
  return timingSafeEqual(expectedDigest, providedDigest);
}

/**
 * Token gate: with PROJECTS_MCP_TOKEN set, the request must carry a matching
 * `Authorization: Bearer <token>`. Timing-safe compare; 401 otherwise.
 */
export function mcpAuthorized(req: Request): boolean {
  return !MCP_BEARER || bearerMatches(req.headers.get("authorization") ?? "");
}

/**
 * Fixed allowlist, never derived from the request: a DNS-rebinding request
 * carries the ATTACKER's Host header, so host validation only works when the
 * accepted set is the server's own loopback addresses.
 */
export function mcpAllowedHosts(hostname: string, port: number): string[] {
  const allowed = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(hostname)) {
    allowed.push(`${hostname}:${port}`);
  }
  return allowed;
}

export function isHttpMode(args: readonly string[] = process.argv): boolean {
  return args.includes("--http") || process.env["MCP_HTTP"] === "1";
}
export function isStdioMode(args: readonly string[] = process.argv): boolean {
  return args.includes("--stdio") || process.env["MCP_STDIO"] === "1";
}
export function resolveMcpHttpPort(args: readonly string[] = process.argv): number {
  const portIndex = args.indexOf("--port");
  if (portIndex >= 0 && args[portIndex + 1]) {
    return parseInt(args[portIndex + 1]!, 10);
  }
  if (process.env["MCP_HTTP_PORT"]) {
    return parseInt(process.env["MCP_HTTP_PORT"], 10);
  }
  return DEFAULT_MCP_HTTP_PORT;
}
export async function handleMcpRequest(
  req: Request,
  buildServer: () => McpServer,
  options: { port?: number; hostname?: string } = {},
): Promise<Response> {
  // Token gate first: with PROJECTS_MCP_TOKEN set, the MCP endpoint requires
  // `Authorization: Bearer <token>`; 401 otherwise. Default-off.
  if (!mcpAuthorized(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const server = buildServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    // DNS-rebinding protection with a fixed loopback allowlist. A hostile
    // Host header (an attacker-resolved hostname) is refused by the SDK.
    enableDnsRebindingProtection: true,
    allowedHosts: mcpAllowedHosts(
      options.hostname ?? MCP_HTTP_HOST,
      options.port ?? DEFAULT_MCP_HTTP_PORT,
    ),
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}
export function startMcpHttpServer(options: {
  name: string;
  port: number;
  buildServer: () => McpServer;
}): { port: number; stop: () => void } {
  const server: ReturnType<typeof Bun.serve> = Bun.serve({
    hostname: MCP_HTTP_HOST,
    port: options.port,
    async fetch(req) {
      // Token gate covers every route the MCP server exposes, /health
      // included, when PROJECTS_MCP_TOKEN is set.
      if (!mcpAuthorized(req)) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      const url = new URL(req.url);
      if (url.pathname === "/health" && req.method === "GET") {
        return Response.json({ status: "ok", name: options.name });
      }
      if (url.pathname === "/mcp") {
        return handleMcpRequest(req, options.buildServer, { port: server.port });
      }
      return new Response("Not Found", { status: 404 });
    },
  });
  process.stderr.write(
    `${options.name}-mcp HTTP listening on http://${MCP_HTTP_HOST}:${server.port}/mcp\n`,
  );
  return { port: server.port ?? options.port, stop: () => server.stop(true) };
}
