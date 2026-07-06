import { healthPayload } from "@hasna/mcp-harness";
import {
  handleMcpHttpRequest as harnessHandleMcpHttpRequest,
} from "@hasna/mcp-harness/bun";
import { DEFAULT_MCP_HTTP_PORT, MCP_NAME } from "./options.js";
import { buildServer } from "./server.js";

/**
 * open-clip MCP HTTP transport boilerplate — now a thin shim over
 * `@hasna/mcp-harness`. The public API (names, signatures, and the
 * `GET /health` / `POST /mcp` route shape) is preserved so `mcp/index.ts` and
 * the tests are unchanged; only the hand-rolled `WebStandardStreamableHTTPServerTransport`
 * wiring and health payload were removed in favor of the shared harness.
 *
 * Unlike open-crawl (which routes `/health` one layer up in `server/index.ts`),
 * open-clip's `handleMcpHttpRequest` does its own `/health` vs `/mcp` routing,
 * so that combined behavior is kept here rather than delegated wholesale to
 * the harness's `/mcp`-only Bun adapter.
 */

export async function handleMcpHttpRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === "/health" && req.method === "GET") {
    return Response.json(healthPayload(MCP_NAME));
  }
  if (url.pathname === "/mcp") {
    return harnessHandleMcpHttpRequest(req, buildServer);
  }
  return new Response("Not Found", { status: 404 });
}

export function startHttpServer(options: { port?: number; hostname?: string; log?: (message: string) => void } = {}): ReturnType<typeof Bun.serve> {
  const port = options.port ?? DEFAULT_MCP_HTTP_PORT;
  const hostname = options.hostname ?? "127.0.0.1";
  const server = Bun.serve({
    port,
    hostname,
    fetch: handleMcpHttpRequest,
  });
  options.log?.(`${MCP_NAME}-mcp HTTP listening on http://${hostname}:${server.port}/mcp`);
  return server;
}
