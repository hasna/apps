import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { healthPayload, isHttpMode as harnessIsHttpMode, resolveMcpHttpPort } from "@hasna/mcp-harness";
import { buildServer } from "./server.js";

// Mode/port/health boilerplate below is hand-wired through `@hasna/mcp-harness`
// (harnessIsHttpMode / resolveMcpHttpPort / healthPayload). The request
// authentication, Origin/CORS, and body-size enforcement below is a bespoke
// security layer (authorizeHttpRequest / isLoopbackHost /
// resolveHttpSecurityConfig / isTrustedHttpOrigin) with no harness equivalent
// — it is preserved exactly as-is rather than routed through the harness's
// generic transport handlers.

export const DEFAULT_HTTP_PORT = 8821;
export const HTTP_NAME = "machines";
export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

export interface StartHttpServerOptions {
  port?: number;
  host?: string;
  name?: string;
  security?: MachinesHttpSecurityConfig;
}

export interface MachinesHttpSecurityConfig {
  apiKey?: string;
  allowUnauthenticated: boolean;
  allowedOrigins: string[];
  maxBodyBytes: number;
}

export function isHttpMode(args: string[] = process.argv.slice(2)): boolean {
  return harnessIsHttpMode(args);
}

export function resolveHttpPort(args: string[] = process.argv.slice(2)): number {
  return resolveMcpHttpPort({ argv: args, default: DEFAULT_HTTP_PORT });
}

function pathnameFromRequest(req: IncomingMessage): string {
  return new URL(req.url ?? "/", "http://127.0.0.1").pathname;
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

export function resolveHttpSecurityConfig(
  env: NodeJS.ProcessEnv = process.env,
  host = "127.0.0.1",
): MachinesHttpSecurityConfig {
  const allowUnauthenticated = env.MACHINES_ALLOW_UNAUTHENTICATED === "1" && isLoopbackHost(host);
  const allowedOrigins = (env.MACHINES_HTTP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const maxBodyBytes = parsePositiveInteger(env.MACHINES_HTTP_MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES);
  return {
    apiKey: env.MACHINES_API_KEY,
    allowUnauthenticated,
    allowedOrigins,
    maxBodyBytes,
  };
}

function parsePositiveInteger(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function safeTokenEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function originValue(req: IncomingMessage): string | undefined {
  const origin = req.headers.origin;
  if (typeof origin === "string") return origin.trim();
  return undefined;
}

export function isTrustedHttpOrigin(origin: string | undefined, host: string, allowedOrigins: string[] = []): boolean {
  if (!origin) return true;
  if (allowedOrigins.includes(origin) || allowedOrigins.includes("*")) return true;

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  return isLoopbackHost(host) && isLoopbackHost(parsed.hostname);
}

export function authorizeHttpOrigin(
  req: IncomingMessage,
  host: string,
  security: MachinesHttpSecurityConfig,
): { ok: true } | { ok: false; status: 403; reason: string } {
  const origin = originValue(req);
  if (isTrustedHttpOrigin(origin, host, security.allowedOrigins)) return { ok: true };
  return {
    ok: false,
    status: 403,
    reason: "Untrusted Origin header for machines MCP HTTP request.",
  };
}

function requestBearerToken(req: IncomingMessage): string | undefined {
  const authorization = req.headers.authorization;
  if (typeof authorization === "string") {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (match?.[1]) return match[1].trim();
  }

  const apiKey = req.headers["x-machines-api-key"];
  if (typeof apiKey === "string") return apiKey.trim();
  if (Array.isArray(apiKey)) return apiKey[0]?.trim();
  return undefined;
}

export function authorizeHttpRequest(
  req: IncomingMessage,
  security: MachinesHttpSecurityConfig,
): { ok: true } | { ok: false; status: 401; reason: string } {
  if (security.allowUnauthenticated) return { ok: true };

  const expected = security.apiKey?.trim();
  if (!expected) {
    return { ok: false, status: 401, reason: "machines MCP HTTP requires MACHINES_API_KEY or loopback-only MACHINES_ALLOW_UNAUTHENTICATED=1." };
  }

  const received = requestBearerToken(req);
  if (received && safeTokenEquals(received, expected)) return { ok: true };
  return { ok: false, status: 401, reason: "Invalid or missing machines MCP HTTP API key." };
}

function corsHeaders(req: IncomingMessage, host: string, security: MachinesHttpSecurityConfig): Record<string, string> {
  const origin = originValue(req);
  if (!origin || !isTrustedHttpOrigin(origin, host, security.allowedOrigins)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, x-machines-api-key, mcp-session-id",
    "access-control-expose-headers": "mcp-session-id",
    "vary": "Origin",
  };
}

function applyCorsHeaders(req: IncomingMessage, res: ServerResponse, host: string, security: MachinesHttpSecurityConfig): void {
  for (const [key, value] of Object.entries(corsHeaders(req, host, security))) {
    res.setHeader(key, value);
  }
}

function writeJson(res: ServerResponse, status: number, payload: Record<string, unknown>, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(payload));
}

function requestContentLength(req: IncomingMessage): number | null {
  const raw = req.headers["content-length"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

class HttpRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function readRequestBody(req: IncomingMessage, maxBodyBytes: number): Promise<unknown> {
  if (req.method !== "POST" && req.method !== "DELETE") {
    return undefined;
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBodyBytes) {
      throw new HttpRequestError(413, `Request body exceeds ${maxBodyBytes} bytes.`);
    }
    chunks.push(buffer);
  }

  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new HttpRequestError(400, "Invalid JSON request body.");
  }
}

async function handleMcpRequest(req: IncomingMessage, res: ServerResponse, maxBodyBytes: number): Promise<void> {
  const server = buildServer(undefined, { mutationTransport: "mcp:http" });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await server.connect(transport);

  try {
    const body = await readRequestBody(req, maxBodyBytes);
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
  const security = options.security ?? resolveHttpSecurityConfig(process.env, host);

  const httpServer = createServer(async (req, res) => {
    const path = pathnameFromRequest(req);

    if (req.method === "GET" && path === "/health") {
      writeJson(res, 200, { ...healthPayload(name) });
      return;
    }

    if (path === "/mcp") {
      const origin = authorizeHttpOrigin(req, host, security);
      if (!origin.ok) {
        writeJson(res, origin.status, { error: "Forbidden", reason: origin.reason });
        return;
      }
      if (req.method === "OPTIONS") {
        res.writeHead(204, corsHeaders(req, host, security));
        res.end();
        return;
      }
      const authorization = authorizeHttpRequest(req, security);
      if (!authorization.ok) {
        writeJson(res, authorization.status, { error: "Unauthorized", reason: authorization.reason }, corsHeaders(req, host, security));
        return;
      }
      const contentLength = requestContentLength(req);
      if (contentLength !== null && contentLength > security.maxBodyBytes) {
        writeJson(res, 413, { error: "Payload Too Large", reason: `Request body exceeds ${security.maxBodyBytes} bytes.` }, corsHeaders(req, host, security));
        return;
      }
      applyCorsHeaders(req, res, host, security);
      try {
        await handleMcpRequest(req, res, security.maxBodyBytes);
      } catch (error) {
        if (error instanceof HttpRequestError) {
          writeJson(res, error.status, { error: error.status === 413 ? "Payload Too Large" : "Bad Request", reason: error.message }, corsHeaders(req, host, security));
          return;
        }
        throw error;
      }
      return;
    }

    writeJson(res, 404, { error: "Not found" });
  });

  httpServer.listen(port, host, () => {
    const address = httpServer.address();
    const boundPort = typeof address === "object" && address ? address.port : port;
    console.error(`machines-mcp HTTP listening on http://${host}:${boundPort}`);
  });

  return httpServer;
}
