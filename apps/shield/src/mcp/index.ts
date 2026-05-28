#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { PACKAGE_VERSION } from "../lib/version.js";
import { parseMcpArgs, isStdioMode, resolveHttpPort } from "./args.js";
import { buildServer, createMcpServer } from "./build-server.js";
import { startMcpHttpServer, DEFAULT_MCP_HTTP_PORT, MCP_HTTP_HOST } from "./http.js";

export { buildServer } from "./build-server.js";
export { startMcpHttpServer, DEFAULT_MCP_HTTP_PORT, MCP_HTTP_HOST } from "./http.js";

const parsedArgs = parseMcpArgs(process.argv.slice(2), PACKAGE_VERSION);
if (parsedArgs) {
  console.log(parsedArgs.text);
  process.exit(0);
}

async function main(): Promise<void> {
  if (isStdioMode()) {
    const transport = new StdioServerTransport();
    await buildServer().connect(transport);
    return;
  }
  // Default: shared Streamable HTTP server (one process per MCP, many agents).
  const port = resolveHttpPort(DEFAULT_MCP_HTTP_PORT);
  await startMcpHttpServer({
    port,
    healthName: "security",
    createServer: createMcpServer,
  });
  console.error(`shield-mcp HTTP listening on http://${MCP_HTTP_HOST}:${port}/mcp`);
}

main().catch((err) => {
  console.error("MCP server error:", err);
  process.exit(1);
});
