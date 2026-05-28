import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildServer } from "./index.js";

export const DEFAULT_MCP_HTTP_PORT = 8842;
export const MCP_HTTP_NAME = "todos";

export function isHttpMode(): boolean {
  return process.argv.includes("--http") || process.env["MCP_HTTP"] === "1";
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

export async function handleMcpHttpRequest(
  req: Request,
  createServer: () => McpServer = buildServer,
): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = createServer();
  await server.connect(transport);
  return transport.handleRequest(req);
}

export async function startHttpServer(
  port: number,
  options?: { createServer?: () => McpServer; name?: string },
): Promise<ReturnType<typeof Bun.serve>> {
  const createServer = options?.createServer ?? buildServer;
  const name = options?.name ?? MCP_HTTP_NAME;

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/health" && req.method === "GET") {
        return healthResponse(name);
      }
      if (url.pathname === "/mcp") {
        return handleMcpHttpRequest(req, createServer);
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    },
  });

  console.error(`todos-mcp HTTP listening on http://127.0.0.1:${port}/mcp`);
  return server;
}
