import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  isHttpMode as harnessIsHttpMode,
  isStdioMode as harnessIsStdioMode,
  resolveMcpHttpPort as harnessResolveMcpHttpPort,
  type McpHttpServerHandle,
} from "@hasna/mcp-harness";
import { startMcpHttpServer as harnessStartMcpHttpServer } from "@hasna/mcp-harness/node";

/**
 * open-shortlinks MCP transport/port boilerplate — thin shim over
 * `@hasna/mcp-harness`. The public API (names, signatures, health shape) is
 * preserved so `mcp/index.ts` is unchanged; only the hand-rolled `node:http` +
 * `StreamableHTTPServerTransport` server, port parsing, and health helpers
 * were removed in favor of the shared harness.
 *
 * shortlinks builds its MCP server with the low-level `Server` (not the
 * high-level `McpServer`); the harness's Node adapter is typed against
 * `McpServer` but only calls `.connect()`/`.close()` at runtime, both of
 * which `Server` implements identically — the cast below mirrors the same
 * pattern used by open-signatures.
 */

export const MCP_HTTP_SERVICE_NAME = "shortlinks";
export const DEFAULT_MCP_HTTP_PORT = 8851;

export type { McpHttpServerHandle };

export function isHttpMode(argv: string[] = process.argv, env: NodeJS.ProcessEnv = process.env): boolean {
  return harnessIsHttpMode(argv, env);
}

export function isStdioMode(argv: string[] = process.argv, env: NodeJS.ProcessEnv = process.env): boolean {
  return harnessIsStdioMode(argv, env);
}

export function resolveMcpHttpPort(argv: string[] = process.argv, env: NodeJS.ProcessEnv = process.env): number {
  return harnessResolveMcpHttpPort({ argv, env, default: DEFAULT_MCP_HTTP_PORT });
}

export async function startMcpHttpServer(
  buildServer: () => Server,
  options?: { port?: number; host?: string; serviceName?: string },
): Promise<McpHttpServerHandle> {
  return harnessStartMcpHttpServer(buildServer as unknown as () => McpServer, {
    port: options?.port,
    host: options?.host,
    serviceName: options?.serviceName ?? MCP_HTTP_SERVICE_NAME,
    defaultPort: DEFAULT_MCP_HTTP_PORT,
  });
}
