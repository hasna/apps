import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer } from "./server.js";

export const DEFAULT_HTTP_PORT = 8865;
export const HTTP_NAME = "markdown";

export interface StartHttpServerOptions {
  port?: number;
  host?: string;
  name?: string;
}

class InvalidJsonBodyError extends Error {
  constructor() {
    super("Parse error: Invalid JSON");
    this.name = "InvalidJsonBodyError";
  }
}

export function isHttpMode(args: string[] = process.argv.slice(2)): boolean {
  return args.includes("--http") || process.env.MCP_HTTP === "1";
}

export function isStdioMode(args: string[] = process.argv.slice(2)): boolean {
  return args.includes("--stdio") || process.env.MCP_STDIO === "1";
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
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid port: ${raw}`);
  }

  const port = Number(raw);
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

  try {
    return JSON.parse(text);
  } catch {
    throw new InvalidJsonBodyError();
  }
}

async function handleMcpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: unknown;
  try {
    body = await readRequestBody(req);
  } catch (error) {
    if (error instanceof InvalidJsonBodyError) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32700, message: error.message },
        id: null,
      }));
      return;
    }
    throw error;
  }

  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await server.connect(transport);

  try {
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
    console.error(`markdown-mcp HTTP listening on http://${host}:${boundPort}`);
  });

  return httpServer;
}
