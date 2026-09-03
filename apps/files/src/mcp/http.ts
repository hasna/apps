import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type McpHttpServerHandle,
  isHttpMode,
  isStdioMode,
  resolveMcpHttpPort as harnessResolveMcpHttpPort,
  startMcpHttpServer as harnessStartMcpHttpServer,
} from "./harness.js";
import { DEFAULT_MCP_HTTP_PORT } from "./options.js";

/**
 * open-files MCP transport/port boilerplate — now a thin shim over the
 * vendored harness (./harness.ts). The public API (names, signatures, health
 * shape) is preserved so `mcp/index.ts` and the tests are unchanged; only the
 * hand-rolled `node:http` + `StreamableHTTPServerTransport` server, port
 * parsing, and health helpers were removed in favor of the in-tree harness.
 */

export const MCP_HTTP_SERVICE_NAME = "files";
export { DEFAULT_MCP_HTTP_PORT } from "./options.js";

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
