import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { DEFAULT_MCP_HTTP_PORT, MCP_NAME } from "./options.js";
import { buildServer } from "./server.js";

export async function handleMcpHttpRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === "/health" && req.method === "GET") {
    return Response.json({ status: "ok", name: MCP_NAME });
  }
  if (url.pathname === "/mcp") {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    const server = buildServer();
    await server.connect(transport);
    return transport.handleRequest(req);
  }
  return new Response("Not Found", { status: 404 });
}

export function startHttpServer(options: { port?: number; hostname?: string; log?: (message: string) => void } = {}): ReturnType<typeof Bun.serve> {
  const port = options.port ?? DEFAULT_MCP_HTTP_PORT;
  const hostname = options.hostname ?? "127.0.0.1";
  const server = Bun.serve({
    port,
    hostname,
    fetch: handleMcpHttpRequest,
  });
  options.log?.(`${MCP_NAME}-mcp HTTP listening on http://${hostname}:${server.port}/mcp`);
  return server;
}
