import { createServer as createHttpServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const DEFAULT_MCP_HTTP_PORT = 8846;
export const MCP_HTTP_HOST = "127.0.0.1";
export const MCP_SERVICE_NAME = "terminal";

export function isHttpMode(args: string[]): boolean {
  return args.includes("--http") || process.env.MCP_HTTP === "1";
}

export function resolveMcpHttpPort(args: string[]): number {
  const portIdx = args.indexOf("--port");
  if (portIdx >= 0 && args[portIdx + 1]) {
    return Number(args[portIdx + 1]);
  }
  const envPort = process.env.MCP_HTTP_PORT;
  if (envPort) return Number(envPort);
  return DEFAULT_MCP_HTTP_PORT;
}

export async function handleMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  buildServer: () => McpServer,
): Promise<void> {
  // Stateless mode: a fresh transport + server per request (sessionIdGenerator
  // undefined). Tear both down once the response closes.
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = buildServer();
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}

export async function startMcpHttpServer(options: {
  name: string;
  port: number;
  buildServer: () => McpServer;
}): Promise<Server> {
  const { name, port, buildServer } = options;

  const http = createHttpServer(async (req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", name }));
      return;
    }
    if (req.url === "/mcp") {
      await handleMcpRequest(req, res, buildServer);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => {
    http.listen(port, MCP_HTTP_HOST, () => resolve());
  });
  console.error(`${name}-mcp HTTP listening on http://${MCP_HTTP_HOST}:${port}/mcp`);
  return http;
}
