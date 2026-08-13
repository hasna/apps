/**
 * MCP Streamable-HTTP plumbing.
 *
 * SECURITY NOTE. Nothing in this module authenticates anything, by design: it
 * is transport plumbing. The DATA-PLANE guard lives at the mount points.
 *   - `serve()` (`src/server/serve.ts`, the ALB-facing server) resolves an auth
 *     posture at startup and calls `handleMcpFetch` only after
 *     `authorizeLocalPlane` allows the request. Before this hotfix it mounted
 *     `/mcp` unguarded, which published all 23 read/write tools anonymously.
 *   - `startMcpHttpServer` below (the `calendar-mcp --http` dev server) binds
 *     loopback ONLY, refuses any non-loopback peer, and additionally requires
 *     the serve credential when one is configured.
 * Do not add a third mount without a guard.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildServer } from "./index.js";
import {
  isLoopbackAddress,
  presentedCredential,
  resolveServeCredential,
  timingSafeEqual,
} from "../server/auth-posture.js";

export const DEFAULT_MCP_HTTP_PORT = 8803;
export const MCP_SERVICE_NAME = "calendar";

export function resolveMcpHttpPort(explicit?: number): number {
  if (explicit != null && !Number.isNaN(explicit)) return explicit;
  const env = process.env.MCP_HTTP_PORT;
  if (env) {
    const parsed = parseInt(env, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return DEFAULT_MCP_HTTP_PORT;
}

export function isHttpMode(argv: string[] = process.argv): boolean {
  return argv.includes("--http") || process.env.MCP_HTTP === "1";
}

export function parseHttpArgv(argv: string[] = process.argv): { http: boolean; port?: number } {
  const http = isHttpMode(argv);
  let port: number | undefined;
  const portIdx = argv.indexOf("--port");
  if (portIdx !== -1 && argv[portIdx + 1]) {
    port = parseInt(argv[portIdx + 1]!, 10);
  }
  return { http, port };
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : undefined;
}

export async function handleStatelessMcpNode(
  req: IncomingMessage,
  res: ServerResponse,
  getServer: () => McpServer | Promise<McpServer> = buildServer,
): Promise<void> {
  const server = await getServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  const body = req.method === "POST" ? await readJsonBody(req) : undefined;
  await transport.handleRequest(req, res, body);
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
}

export async function handleMcpFetch(
  request: Request,
  getServer: () => McpServer | Promise<McpServer> = buildServer,
): Promise<Response> {
  const server = await getServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  const response = await transport.handleRequest(request);
  response.headers.set("Access-Control-Allow-Origin", "*");
  return response;
}

export function healthPayload(name: string = MCP_SERVICE_NAME): { status: string; name: string } {
  return { status: "ok", name };
}

/**
 * Guard for the loopback-only `calendar-mcp --http` dev server.
 *
 * Returns `null` to allow, or the denial to write. Two independent conditions:
 *   1. the RAW transport peer must be loopback (`req.socket.remoteAddress`;
 *      `x-forwarded-for` is deliberately ignored so a proxy cannot forge it);
 *   2. when a serve credential is configured, it must be presented.
 */
export function denyLocalMcp(
  req: IncomingMessage,
  env: NodeJS.ProcessEnv = process.env,
): { status: number; body: { error: string; code: string } } | null {
  if (!isLoopbackAddress(req.socket?.remoteAddress)) {
    return { status: 404, body: { error: "not found", code: "LOCAL_PLANE_DISABLED" } };
  }
  const credential = resolveServeCredential(env);
  if (!credential) return null;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(key, value);
    else if (Array.isArray(value) && value[0]) headers.set(key, value[0]);
  }
  const presented = presentedCredential(headers);
  if (presented && timingSafeEqual(presented, credential)) return null;
  return { status: 401, body: { error: "authentication required", code: "UNAUTHENTICATED" } };
}

export async function startMcpHttpServer(options: {
  port?: number;
  getServer?: () => McpServer | Promise<McpServer>;
  name?: string;
} = {}): Promise<{ port: number; close: () => Promise<void> }> {
  const port = options.port ?? resolveMcpHttpPort();
  const host = "127.0.0.1";
  const getServer = options.getServer ?? buildServer;
  const name = options.name ?? MCP_SERVICE_NAME;

  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(healthPayload(name)));
      return;
    }

    if (url.pathname === "/mcp") {
      const denial = denyLocalMcp(req);
      if (denial) {
        res.writeHead(denial.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(denial.body));
        return;
      }
      await handleStatelessMcpNode(req, res, getServer);
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => resolve());
  });

  const address = httpServer.address();
  const boundPort = typeof address === "object" && address ? address.port : port;

  return {
    port: boundPort,
    close: () =>
      new Promise((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
