import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./server.js";
import { isHttpMode, resolveHttpPort, startHttpServer } from "./http.js";

export { buildServer, MCP_NAME } from "./server.js";
export { DEFAULT_MCP_HTTP_PORT, isHttpMode, resolveHttpPort, startHttpServer } from "./http.js";

export async function startStdioServer(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/** @deprecated use startStdioServer */
export const startMcpServer = startStdioServer;

async function main(): Promise<void> {
  if (isHttpMode()) {
    await startHttpServer({ port: resolveHttpPort() });
    return;
  }

  await startStdioServer();
}

if (import.meta.main) {
  main().catch((err) => {
    process.stderr.write("MCP server error: " + String(err) + "\n");
    process.exit(1);
  });
}
