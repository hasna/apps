// Vendored from @hasna/mcp-harness@0.1.0 — the MCP port/mode primitives and
// Bun adapters secrets' MCP transport uses. The source repo ("open-mcp") is
// retired and the public package was deleted per the owner directive
// 2026-09-03 (hasna/apps#1528), so the needed surface is inlined here — same
// pattern as apps/telephony/src/generated/mcp-harness.ts. Ported from the
// published npm tarball (dist/); semantics unchanged.

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

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

function healthPayload(name: string): { status: string; name: string } {
  return { status: "ok", name };
}

/** Minimal structural shape the HTTP adapters need from a built MCP server. */
export interface ConnectableMcpServer {
  connect(transport: unknown): Promise<void>;
  close(): Promise<void>;
}

export type BuildServer = () => ConnectableMcpServer | Promise<ConnectableMcpServer>;

/** Handle returned by the Bun HTTP adapter. */
export interface BunHttpServerHandle {
  port: number;
  stop: () => void;
}

/**
 * Handle one MCP request using Web-standard `Request` / `Response`. Emits a
 * JSON-RPC `-32603` 500 on failure.
 */
export async function handleMcpHttpRequest(
  req: Request,
  buildServer: BuildServer,
  options?: { enableJsonResponse?: boolean },
): Promise<Response> {
  try {
    const server = await buildServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: options?.enableJsonResponse,
    });
    await server.connect(transport);
    return await transport.handleRequest(req);
  } catch (error) {
    console.error("[mcp] HTTP error:", error);
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null },
      { status: 500 },
    );
  }
}

/**
 * Start a `Bun.serve` HTTP server exposing `GET /health` and `POST /mcp`.
 * Returns the bound port and a `stop()`.
 */
export function startBunHttpServer(
  buildServer: BuildServer,
  options: { port: number; host?: string; serviceName: string; enableJsonResponse?: boolean },
): BunHttpServerHandle {
  const host = options.host ?? "127.0.0.1";
  const serviceName = options.serviceName;
  const enableJsonResponse = options.enableJsonResponse;
  const server = Bun.serve({
    hostname: host,
    port: options.port,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/health" && req.method === "GET") {
        return Response.json(healthPayload(serviceName));
      }
      if (url.pathname === "/mcp") {
        return handleMcpHttpRequest(req, buildServer, { enableJsonResponse });
      }
      return new Response("Not Found", { status: 404 });
    },
  });
  process.stderr.write(`${serviceName} MCP HTTP listening on http://${host}:${server.port}/mcp\n`);
  return { port: server.port ?? options.port, stop: () => server.stop(true) };
}