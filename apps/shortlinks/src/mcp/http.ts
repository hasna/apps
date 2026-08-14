import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

/**
 * open-shortlinks MCP transport/port boilerplate — self-contained, with NO
 * external harness dependency. The prior version depended on the unpublished
 * `@hasna/mcp-harness` (a `file:` link), which made `shortlinks-mcp`
 * unstartable on a fresh `npm i` / `bun add -g`. This version inlines the tiny
 * amount of transport glue using only the published `@modelcontextprotocol/sdk`
 * and Bun's built-in HTTP server, matching the pattern used by the reference
 * apps (open-conversations, open-mementos).
 *
 * shortlinks builds its MCP server with the low-level `Server`; the WebStandard
 * transport's `.connect()` works identically on `Server` and the high-level
 * `McpServer`.
 */

export const MCP_HTTP_SERVICE_NAME = "shortlinks";
export const MCP_HTTP_HOST = "127.0.0.1";
export const DEFAULT_MCP_HTTP_PORT = 8851;

export interface McpHttpServerHandle {
  port: number;
  host: string;
  url: string;
  close(): Promise<void>;
}

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
  if (portIdx >= 0 && argv[portIdx + 1]) {
    const parsed = Number(argv[portIdx + 1]);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (env.MCP_HTTP_PORT) {
    const parsed = Number(env.MCP_HTTP_PORT);
    if (Number.isFinite(parsed)) return parsed;
  }
  return DEFAULT_MCP_HTTP_PORT;
}

function healthPayload(name: string): { status: string; name: string } {
  return { status: "ok", name };
}

async function handleMcpRequest(req: Request, buildServer: () => Server): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  const server = buildServer();
  await server.connect(transport);
  return transport.handleRequest(req);
}

export async function startMcpHttpServer(
  buildServer: () => Server,
  options?: { port?: number; host?: string; serviceName?: string },
): Promise<McpHttpServerHandle> {
  const port = options?.port ?? DEFAULT_MCP_HTTP_PORT;
  const host = options?.host ?? MCP_HTTP_HOST;
  const serviceName = options?.serviceName ?? MCP_HTTP_SERVICE_NAME;

  const server = Bun.serve({
    hostname: host,
    port,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/health" && req.method === "GET") {
        return Response.json(healthPayload(serviceName));
      }
      if (url.pathname === "/mcp") {
        return handleMcpRequest(req, buildServer);
      }
      return new Response("Not Found", { status: 404 });
    },
  });

  const boundPort = server.port ?? port;
  const resolvedUrl = `http://${host}:${boundPort}/mcp`;
  console.error(`${serviceName}-mcp HTTP listening on ${resolvedUrl}`);

  return {
    port: boundPort,
    host,
    url: resolvedUrl,
    async close() {
      await server.stop(true);
    },
  };
}
