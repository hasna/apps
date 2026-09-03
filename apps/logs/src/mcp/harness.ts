// Vendored from @hasna/mcp-harness@0.1.0 — the MCP port/mode/health
// primitives and Node adapter logs' MCP transport uses. The source repo
// ("open-mcp") is retired and the public package was deleted per the owner
// directive 2026-09-03 (hasna/apps#1528), so the needed surface is inlined
// here — same pattern as apps/telephony/src/generated/mcp-harness.ts. Ported
// from the published npm tarball (dist/); semantics unchanged.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const PORT_MIN = 0;
const PORT_MAX = 65535;
const DEFAULT_MCP_HTTP_PORT = 8899;

function invalidPortMessage(source: string, value: string): string {
  return `Invalid ${source} "${value}". Expected an integer between ${PORT_MIN} and ${PORT_MAX}.`;
}

function validatePort(port: number, source: string): number {
  if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) {
    throw new Error(invalidPortMessage(source, String(port)));
  }
  return port;
}

function parsePortValue(value: string, source: string): number {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(invalidPortMessage(source, value));
  }
  return validatePort(Number(trimmed), source);
}

export function isStdioMode(argv: readonly string[] = process.argv, env: NodeJS.ProcessEnv = process.env): boolean {
  return argv.includes("--stdio") || env.MCP_STDIO === "1";
}

export function isHttpMode(argv: readonly string[] = process.argv, env: NodeJS.ProcessEnv = process.env): boolean {
  return argv.includes("--http") || env.MCP_HTTP === "1";
}

function parseHttpArgv(argv: readonly string[] = process.argv): { http: boolean; port?: number } {
  const http = isHttpMode(argv);
  let port: number | undefined;

  const portEqualsArg = argv.find((arg) => arg.startsWith("--port="));
  if (portEqualsArg) {
    port = parsePortValue(portEqualsArg.slice("--port=".length), "--port");
  }

  const portIdx = argv.indexOf("--port");
  if (portIdx !== -1) {
    const value = argv[portIdx + 1];
    if (value === undefined) {
      throw new Error(invalidPortMessage("--port", ""));
    }
    port = parsePortValue(value, "--port");
  }

  return { http, port };
}

export function resolveMcpHttpPort(opts?: {
  explicit?: number;
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
  default?: number;
}): number {
  const argv = opts?.argv ?? process.argv;
  const env = opts?.env ?? process.env;

  if (opts?.explicit != null) {
    return validatePort(opts.explicit, "--port");
  }

  const { port } = parseHttpArgv(argv);
  if (port != null) return port;

  const envPort = env.MCP_HTTP_PORT;
  if (envPort && envPort.trim() !== "") {
    return parsePortValue(envPort, "MCP_HTTP_PORT");
  }

  return opts?.default ?? DEFAULT_MCP_HTTP_PORT;
}

export function healthPayload(name: string): { status: string; name: string } {
  return { status: "ok", name };
}

/** Minimal structural shape the HTTP adapters need from a built MCP server. */
export interface ConnectableMcpServer {
  connect(transport: unknown): Promise<void>;
  close(): Promise<void>;
}

export type BuildServer = () => ConnectableMcpServer | Promise<ConnectableMcpServer>;

/** Handle returned by the Node HTTP adapter. */
export interface McpHttpServerHandle {
  port: number;
  host: string;
  close: () => Promise<void>;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  if (chunks.length === 0) return undefined;
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? (JSON.parse(text) as unknown) : undefined;
}

/**
 * Handle a single stateless MCP request. Emits a JSON-RPC `-32603` 500 on
 * failure.
 */
export async function handleStatelessMcpNode(
  req: IncomingMessage,
  res: ServerResponse,
  buildServer: BuildServer,
  serviceName: string,
): Promise<void> {
  try {
    const server = await buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);

    const body = req.method === "POST" ? await readJsonBody(req) : undefined;
    await transport.handleRequest(req, res, body);

    res.on("close", () => {
      void transport.close();
      void server.close();
    });
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
}

/**
 * Start a Node HTTP server serving `GET /health` and `POST /mcp` on
 * `127.0.0.1` (by default). Returns a handle with the bound port and a
 * `close()`.
 */
export async function startMcpHttpServer(
  buildServer: BuildServer,
  options?: { port?: number; host?: string; serviceName?: string; defaultPort?: number },
): Promise<McpHttpServerHandle> {
  const host = options?.host ?? "127.0.0.1";
  const serviceName = options?.serviceName ?? "mcp";
  const requestedPort = options?.port ?? resolveMcpHttpPort({ default: options?.defaultPort });
  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(healthPayload(serviceName)));
      return;
    }
    if (url.pathname === "/mcp") {
      await handleStatelessMcpNode(req, res, buildServer, serviceName);
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
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
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

/**
 * Test helper — kept for API stability. The harness is stateless per-request,
 * so there is no shared transport state to reset.
 */
export function resetMcpHttpStateForTests(): void {}