#!/usr/bin/env bun

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import pkg from "../../package.json";
import { DEFAULT_MCP_HTTP_PORT, isHttpMode, parseCliPort, startMcpHttpServer } from "./http.js";

const cliArgs = new Set(process.argv.slice(2));
if (cliArgs.has("--help") || cliArgs.has("-h")) {
  console.log(`Usage: testers-mcp [options]

Open Testers MCP server (stdio transport by default)

Options:
  -h, --help       Show this help message
  -V, --version    Show version
      --http       Start Streamable HTTP transport on 127.0.0.1 (env: MCP_HTTP=1)
      --port <n>   HTTP port (default ${DEFAULT_MCP_HTTP_PORT}, env: MCP_HTTP_PORT)
`);
  process.exit(0);
}

if (cliArgs.has("--version") || cliArgs.has("-V")) {
  console.log(pkg.version);
  process.exit(0);
}

// ─── Connect ─────────────────────────────────────────────────────────────────

// Keep MCP stdio transport alive even if a tool implementation throws asynchronously.
process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
  console.error(`[testers-mcp] Unhandled promise rejection: ${msg}`);
});
process.on("uncaughtException", (err) => {
  console.error(`[testers-mcp] Uncaught exception: ${err.stack ?? err.message}`);
});

async function main() {
  const args = process.argv.slice(2);
  if (isHttpMode(args)) {
    await startMcpHttpServer({ name: "testers", port: parseCliPort(args) });
    return;
  }

  const { buildServer } = await import("./server.js");
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Failed to start testers:", error);
  process.exit(1);
});
