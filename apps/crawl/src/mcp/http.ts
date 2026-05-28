import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const MCP_HTTP_HOST = "127.0.0.1";
export const MCP_SERVER_NAME = "crawl";
export const DEFAULT_MCP_HTTP_PORT = 8857;

export function isHttpMode(argv: readonly string[]): boolean {
  return argv.includes("--http") || process.env["MCP_HTTP"] === "1";
}

export function isStdioMode(argv: readonly string[]): boolean {
  return argv.includes("--stdio") || process.env["MCP_STDIO"] === "1";
}

export function resolveMcpHttpPort(argv: readonly string[]): number {
  const portIndex = argv.indexOf("--port");
  if (portIndex >= 0 && argv[portIndex + 1]) {
    return parseInt(argv[portIndex + 1]!, 10);
  }
  if (process.env["MCP_HTTP_PORT"]) {
    return parseInt(process.env["MCP_HTTP_PORT"], 10);
  }
  return DEFAULT_MCP_HTTP_PORT;
}

export function mcpHealthJson(): { status: string; name: string } {
  return { status: "ok", name: MCP_SERVER_NAME };
}

export async function handleMcpHttpRequest(
  req: Request,
  buildServer: () => McpServer,
): Promise<Response> {
  const server = buildServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}

export async function startHttpServer(
  buildServer: () => McpServer,
  port: number,
): Promise<{ port: number; stop: () => void }> {
  const server = Bun.serve({
    hostname: MCP_HTTP_HOST,
    port,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/health" && req.method === "GET") {
        return Response.json(mcpHealthJson());
      }
      if (url.pathname === "/mcp") {
        return handleMcpHttpRequest(req, buildServer);
      }
      return new Response("Not Found", { status: 404 });
    },
  });
  process.stderr.write(
    `${MCP_SERVER_NAME} MCP HTTP listening on http://${MCP_HTTP_HOST}:${server.port}/mcp\n`,
  );
  return { port: server.port!, stop: () => server.stop(true) };
}

export function resetMcpHttpStateForTests(): void {
  // no shared transport state in stateless per-request mode
}
