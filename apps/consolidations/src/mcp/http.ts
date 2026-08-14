import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { resolveStorageMode } from "../config.js";
import { authenticateRequest, isApiAuthConfigured } from "../server/auth.js";
import { SYSTEM_PRINCIPAL } from "../services/execute.js";
import { buildServer, getProfile } from "./index.js";

export const DEFAULT_MCP_HTTP_PORT = 8892;
export const MCP_HTTP_NAME = "consolidations";

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

/**
 * Auth is fail-closed: it may only be disabled with HASNA_CONSOLIDATIONS_MCP_AUTH=off
 * AND in local mode (the transport always binds loopback). Any cloud-mode bind
 * keeps auth on regardless of the flag.
 */
export function authDisabled(): boolean {
  return process.env["HASNA_CONSOLIDATIONS_MCP_AUTH"] === "off" && resolveStorageMode() === "local";
}

export function healthResponse(name = MCP_HTTP_NAME): Response {
  return Response.json({ status: "ok", name });
}

function unauthorized(): Response {
  return Response.json(
    { code: "UNAUTHORIZED", message: "Invalid or missing bearer token.", suggestion: "Provide Authorization: Bearer <token>." },
    { status: 401 },
  );
}

export async function handleMcpHttpRequest(req: Request): Promise<Response> {
  let createServer: () => ReturnType<typeof buildServer>;
  if (authDisabled()) {
    createServer = () => buildServer({ principal: SYSTEM_PRINCIPAL, profile: getProfile() });
  } else {
    const principal = authenticateRequest(req);
    if (!principal) return unauthorized();
    createServer = () => buildServer({ principal, profile: getProfile() });
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = createServer();
  await server.connect(transport);
  return transport.handleRequest(req);
}

export async function startHttpServer(port: number): Promise<ReturnType<typeof Bun.serve>> {
  if (!authDisabled() && !isApiAuthConfigured()) {
    // Fail-closed: refuse to serve an authenticated transport with no credentials
    // configured (would 401 everything) unless auth is explicitly disabled in local.
    console.error(
      "[consolidations-mcp] No API credentials configured and auth is on. Set HASNA_CONSOLIDATIONS_API_CREDENTIALS " +
        "or (local only) HASNA_CONSOLIDATIONS_MCP_AUTH=off.",
    );
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/health" && req.method === "GET") return healthResponse();
      if (url.pathname === "/mcp") return handleMcpHttpRequest(req);
      return Response.json({ error: "Not found" }, { status: 404 });
    },
  });
  console.error(`consolidations-mcp HTTP listening on http://127.0.0.1:${port}/mcp`);
  return server;
}
