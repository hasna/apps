import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildServer } from "./server.js";
import { logAuditEvent } from "../db/index.js";
import {
  authorizeRequest,
  corsHeadersForRequest,
  corsPreflightHeaders,
  hasDisallowedCorsOrigin,
  resolveSecurityConfig,
  type ServerSecurityConfig,
  withCorsHeaders,
} from "../server/security.js";

export const MCP_HTTP_PORT = 8883;
export const MCP_NAME = "computer";

export function isHttpMode(argv: string[]): boolean {
  return argv.includes("--http") || process.env.MCP_HTTP === "1";
}

export function isStdioMode(argv: string[]): boolean {
  return argv.includes("--stdio") || process.env.MCP_STDIO === "1";
}

export function resolveHttpPort(argv: string[]): number {
  const eqArg = argv.find((a) => a.startsWith("--port="));
  if (eqArg) {
    const parsed = Number.parseInt(eqArg.slice("--port=".length), 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  const idx = argv.indexOf("--port");
  if (idx >= 0) {
    const parsed = Number.parseInt(argv[idx + 1] ?? "", 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  const envPort = process.env.MCP_HTTP_PORT;
  if (envPort) {
    const parsed = Number.parseInt(envPort, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return MCP_HTTP_PORT;
}

export function healthPayload(): { status: string; name: string } {
  return { status: "ok", name: MCP_NAME };
}

async function handleMcpRequest(req: Request): Promise<Response> {
  const server = buildServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}

/** Handle /health and /mcp; return null if the request is unrelated. */
export async function handleMcpHttpRequest(req: Request): Promise<Response | null> {
  const url = new URL(req.url);
  if (url.pathname === "/health" && req.method === "GET") {
    return Response.json(healthPayload());
  }
  if (url.pathname === "/mcp") {
    return handleMcpRequest(req);
  }
  return null;
}

export async function startMcpHttpServer(
  port: number,
  security: ServerSecurityConfig = resolveSecurityConfig(process.env, port)
): Promise<{ port: number; stop: () => void }> {
  const httpServer = Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(req) {
      if (req.method === "OPTIONS") {
        if (hasDisallowedCorsOrigin(req, security)) {
          return Response.json(
            { error: "CORS origin not allowed" },
            { status: 403, headers: corsHeadersForRequest(req, security) }
          );
        }
        return new Response(null, { headers: corsPreflightHeaders(req, security) });
      }
      if (hasDisallowedCorsOrigin(req, security)) {
        await logAuditEvent({
          event: "http.cors",
          transport: "mcp-http",
          capability: "http.cors",
          decision: "denied",
          reason: "CORS origin not allowed",
          metadata: {
            method: req.method,
            path: new URL(req.url).pathname,
            origin: req.headers.get("origin") ?? undefined,
          },
        });
        return Response.json(
          { error: "CORS origin not allowed" },
          { status: 403, headers: corsHeadersForRequest(req, security) }
        );
      }
      const auth = authorizeRequest(req, security);
      if (!auth.ok) {
        await logAuditEvent({
          event: "http.auth",
          transport: "mcp-http",
          capability: "http.auth",
          decision: "denied",
          reason: auth.reason,
          metadata: {
            method: req.method,
            path: new URL(req.url).pathname,
          },
        });
        return Response.json({ error: auth.reason }, { status: auth.status, headers: corsHeadersForRequest(req, security) });
      }
      const handled = await handleMcpHttpRequest(req);
      if (handled) return withCorsHeaders(handled, req, security);
      return Response.json({ error: "Not found" }, { status: 404, headers: corsHeadersForRequest(req, security) });
    },
  });
  return { port: httpServer.port!, stop: () => httpServer.stop() };
}
