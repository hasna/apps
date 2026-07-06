import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  isHttpMode,
  isStdioMode,
  resolveMcpHttpPort as harnessResolveMcpHttpPort,
  type McpHttpServerHandle,
} from "@hasna/mcp-harness";
import { startMcpHttpServer as harnessStartMcpHttpServer } from "@hasna/mcp-harness/node";

/**
 * open-files MCP transport/port boilerplate — now a thin shim over
 * `@hasna/mcp-harness`. The public API (names, signatures, health shape) is
 * preserved so `mcp/index.ts` and the tests are unchanged; only the hand-rolled
 * `node:http` + `StreamableHTTPServerTransport` server, port parsing, and health
 * helpers were removed in favor of the shared harness.
 */

export const MCP_HTTP_SERVICE_NAME = "files";
export const DEFAULT_MCP_HTTP_PORT = 8863;

export { isHttpMode, isStdioMode };
export type { McpHttpServerHandle };

export function resolveMcpHttpPort(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): number {
  return harnessResolveMcpHttpPort({ argv, env, default: DEFAULT_MCP_HTTP_PORT });
}

export async function startMcpHttpServer(
  buildServer: () => McpServer,
  options?: { port?: number; host?: string; serviceName?: string },
): Promise<McpHttpServerHandle> {
  return harnessStartMcpHttpServer(buildServer, {
    port: options?.port,
    host: options?.host,
    serviceName: options?.serviceName ?? MCP_HTTP_SERVICE_NAME,
    defaultPort: DEFAULT_MCP_HTTP_PORT,
  });
}
