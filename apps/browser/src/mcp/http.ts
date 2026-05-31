import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const MCP_HTTP_SERVICE_NAME = "browser";
export const DEFAULT_MCP_HTTP_PORT = 8851;

export function isHttpMode(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return argv.includes("--http") || env.MCP_HTTP === "1";
}

export function isStdioMode(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return argv.includes("--stdio") || env.MCP_STDIO === "1";
}

export function resolveMcpHttpPort(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const portIdx = argv.indexOf("--port");
  if (portIdx !== -1 && argv[portIdx + 1]) {
    return parsePort(argv[portIdx + 1]!, "--port");
  }
  if (env.MCP_HTTP_PORT) {
    return parsePort(env.MCP_HTTP_PORT, "MCP_HTTP_PORT");
  }
  return DEFAULT_MCP_HTTP_PORT;
}

function parsePort(raw: string, source: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`Invalid ${source} value "${raw}". Expected 0-65535.`);
  }
  return parsed;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return undefined;
  return JSON.parse(text) as unknown;
}

export type McpHttpServerHandle = {
  port: number;
  host: string;
  close: () => Promise<void>;
};

function settleWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.then(() => undefined, () => undefined),
    new Promise<void>((resolve) => {
      timeout = setTimeout(resolve, timeoutMs);
    }),
  ]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

export async function startMcpHttpServer(
  buildServer: () => McpServer,
  options?: { port?: number; host?: string; serviceName?: string },
): Promise<McpHttpServerHandle> {
  const host = options?.host ?? "127.0.0.1";
  const requestedPort = options?.port ?? resolveMcpHttpPort();
  const serviceName = options?.serviceName ?? MCP_HTTP_SERVICE_NAME;
  const activeCloses = new Set<Promise<void>>();

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      if (req.method === "GET" && url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", name: serviceName }));
        return;
      }

      if (url.pathname !== "/mcp") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
        return;
      }

      const server = buildServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      await server.connect(transport);
      let closed = false;
      const closeRequestServer = () => {
        if (closed) return;
        closed = true;

        const closePromise = settleWithin(
          Promise.allSettled([
            transport.close(),
            server.close(),
          ]),
          1_000,
        );

        activeCloses.add(closePromise);
        closePromise.finally(() => activeCloses.delete(closePromise));
      };
      res.once("close", closeRequestServer);
      res.once("finish", closeRequestServer);

      let parsedBody: unknown;
      if (req.method === "POST") {
        parsedBody = await readJsonBody(req);
      }

      await transport.handleRequest(req, res, parsedBody);
    } catch (error) {
      console.error(`[${serviceName}-mcp] HTTP error:`, error);
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
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(requestedPort, host, () => resolve());
  });

  const addr = httpServer.address();
  const port = typeof addr === "object" && addr ? addr.port : requestedPort;

  console.error(`[${serviceName}-mcp] Streamable HTTP listening on http://${host}:${port}/mcp`);

  return {
    port,
    host,
    close: async () => {
      await settleWithin(new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
        httpServer.closeIdleConnections?.();
        httpServer.closeAllConnections?.();
      }), 1_000);
      await Promise.allSettled(activeCloses);
    },
  };
}
