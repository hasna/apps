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

/**
 * Which transport `files-mcp` serves. Stdio is the DEFAULT — the fleet
 * convention, and what `--help` and the README document — and Streamable
 * HTTP is the opt-in (`--http` or `MCP_HTTP=1`). A flag beats the
 * environment, and `--stdio` always wins, so `MCP_HTTP=1 files-mcp --stdio`
 * still serves stdio. (The published 0.4.0 had this inverted and bound
 * 127.0.0.1 whenever `--stdio` was absent.)
 */
export function selectsMcpHttpTransport(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (argv.includes("--stdio")) return false;
  if (argv.includes("--http")) return true;
  return isHttpMode(argv, env) && !isStdioMode(argv, env);
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
