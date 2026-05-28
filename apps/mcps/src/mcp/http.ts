import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer } from "./server.js";

export const DEFAULT_HTTP_PORT = 8823;
export const HTTP_NAME = "mcps";

export interface StartHttpServerOptions {
  port?: number;
  host?: string;
  name?: string;
}

export function isHttpMode(args: string[] = process.argv.slice(2)): boolean {
  return args.includes("--http") || process.env.MCP_HTTP === "1";
}

export function resolveHttpPort(args: string[] = process.argv.slice(2)): number {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--port" && args[i + 1]) {
      return parsePort(args[i + 1]);
    }
    if (arg.startsWith("--port=")) {
      return parsePort(arg.slice("--port=".length));
    }
  }

  const envPort = process.env.MCP_HTTP_PORT;
  if (envPort) {
    return parsePort(envPort);
  }

  return DEFAULT_HTTP_PORT;
}

function parsePort(raw: string): number {
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${raw}`);
  }
  return port;
}

function pathnameFromRequest(req: IncomingMessage): string {
  return new URL(req.url ?? "/", "http://127.0.0.1").pathname;
}

async function readRequestBody(req: IncomingMessage): Promise<unknown> {
  if (req.method !== "POST" && req.method !== "DELETE") {
    return undefined;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) {
    return undefined;
  }

  return JSON.parse(text);
}

async function handleMcpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await server.connect(transport);

  try {
    const body = await readRequestBody(req);
    await transport.handleRequest(req, res, body);
  } finally {
    res.on("close", () => {
      void transport.close().catch(() => undefined);
      void server.close().catch(() => undefined);
    });
  }
}

export function startHttpServer(options: StartHttpServerOptions = {}): Server {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? resolveHttpPort();
  const name = options.name ?? HTTP_NAME;

  const httpServer = createServer(async (req, res) => {
    const path = pathnameFromRequest(req);

    if (req.method === "GET" && path === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", name }));
      return;
    }

    if (path === "/mcp") {
      await handleMcpRequest(req, res);
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  httpServer.listen(port, host, () => {
    const address = httpServer.address();
    const boundPort = typeof address === "object" && address ? address.port : port;
    console.error(`mcps-mcp HTTP listening on http://${host}:${boundPort}`);
  });

  return httpServer;
}
