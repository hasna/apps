#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { isHttpMode, resolveHttpPort, startHttpServer } from "./http.js";
import { buildServer } from "./server.js";

export { buildServer, createMcpServer, VERSION } from "./server.js";
export { isHttpMode, resolveHttpPort, startHttpServer, DEFAULT_HTTP_PORT, HTTP_NAME } from "./http.js";
export {
  buildMcpTools,
  listTools,
  registerMcpTools,
  tools,
} from "./tools.js";
export type { McpsMcpToolDefinition } from "./tools.js";

export async function startMcpServer() {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export async function main(args: string[] = process.argv.slice(2)) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`Usage: mcps-mcp [options]

Meta-MCP registry server (stdio transport by default)

Options:
  --http         Start Streamable HTTP transport on 127.0.0.1 (or MCP_HTTP=1)
  --port <n>     HTTP port (default: 8823, or MCP_HTTP_PORT env)
  -V, --version  output the version number
  -h, --help     display help for command`);
    return;
  }

  if (args.includes("--version") || args.includes("-V")) {
    const { VERSION } = await import("./server.js");
    console.log(VERSION);
    return;
  }

  if (isHttpMode(args)) {
    startHttpServer({ port: resolveHttpPort(args) });
    return;
  }

  await startMcpServer();
}

const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("/mcp/index.ts") ||
  process.argv[1]?.endsWith("/bin/mcp.js");

if (isDirectRun) {
  main().catch((error) => {
    console.error("MCP server error:", error);
    process.exit(1);
  });
}
