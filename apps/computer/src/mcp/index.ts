#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./server.js";
import { isHttpMode, resolveHttpPort, startMcpHttpServer } from "./http.js";
import { VERSION } from "../version.js";

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--version") || argv.includes("-V")) {
    console.log(VERSION);
    return;
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(`computer-mcp ${VERSION}

Usage:
  computer-mcp [--stdio]
  computer-mcp --http [--port <port>]

Options:
  --stdio       Run MCP over stdio
  --http        Run MCP Streamable HTTP server
  --port <n>    HTTP port (default: 8883)
  -h, --help    Show this help
  -V, --version Show version`);
    return;
  }

  if (isHttpMode(argv)) {
    const port = resolveHttpPort(argv);
    const { port: boundPort } = await startMcpHttpServer(port);
    console.error(`computer-mcp HTTP listening on http://127.0.0.1:${boundPort}/mcp`);
    return;
  }

  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("MCP server error:", err);
    process.exit(1);
  });
}

export { buildServer } from "./server.js";
