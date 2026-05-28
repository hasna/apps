import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer, type Server } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer } from "./index.js";

const DEFAULT_PORT = 8802;

export function startHttpServer(port = Number(process.env.MCP_HTTP_PORT) || DEFAULT_PORT): Server {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  server.connect(transport);
  const http = createServer(async (req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", name: "brains" }));
      return;
    }
    if (req.url === "/mcp") {
      await transport.handleRequest(req, res);
      return;
    }
    res.writeHead(404);
    res.end();
    return;
  });
  http.listen(port, "127.0.0.1");
  return http;
}

if (import.meta.main) {
  startHttpServer();
}
