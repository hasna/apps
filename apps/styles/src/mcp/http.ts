import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer, MCP_NAME } from "./server.js";

export const DEFAULT_MCP_HTTP_PORT = 8837;

export function resolveHttpPort(argv: string[] = process.argv.slice(2)): number {
  const portIdx = argv.indexOf("--port");
  if (portIdx !== -1 && argv[portIdx + 1]) {
    return parseInt(argv[portIdx + 1]!, 10);
  }
  if (process.env.MCP_HTTP_PORT) {
    return parseInt(process.env.MCP_HTTP_PORT, 10);
  }
  return DEFAULT_MCP_HTTP_PORT;
}

export function isHttpMode(argv: string[] = process.argv.slice(2)): boolean {
  return argv.includes("--http") || process.env.MCP_HTTP === "1";
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  if (chunks.length === 0) return undefined;
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export type HttpServerHandle = {
  port: number;
  close: () => Promise<void>;
};

export async function startHttpServer(options: { port?: number; host?: string } = {}): Promise<HttpServerHandle> {
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? resolveHttpPort();

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", `http://${host}:${requestedPort}`);

    if (url.pathname === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", name: MCP_NAME }));
      return;
    }

    if (url.pathname === "/mcp") {
      const server = buildServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      try {
        await server.connect(transport);
        const body =
          req.method === "POST" || req.method === "DELETE" ? await readBody(req) : undefined;
        await transport.handleRequest(req, res, body);
        res.on("close", () => {
          void transport.close();
          void server.close();
        });
      } catch (err) {
        process.stderr.write(`MCP HTTP error: ${String(err)}\n`);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32603, message: "Internal server error" },
              id: null,
            }),
          );
        }
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(requestedPort, host, () => resolve());
  });

  const address = httpServer.address();
  const port = typeof address === "object" && address ? address.port : requestedPort;

  process.stderr.write(`@hasna/styles MCP HTTP server at http://${host}:${port}/mcp\n`);

  return {
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
