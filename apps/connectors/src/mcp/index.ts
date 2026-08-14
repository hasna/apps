#!/usr/bin/env bun

// Fellow agents: keep this entrypoint on Bun; the bundled MCP binary emits `bun:` imports and Node breaks the initialize handshake.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConnectorVersions } from "../lib/registry.js";
import pkg from "../../package.json" with { type: "json" };
import { buildServer } from "./server.js";
import { isStdioMode, resolveHttpPort, startMcpHttpServer } from "./http.js";

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function printHelp(): void {
  console.log(`Usage: connectors-mcp [options]

Start the Connectors MCP server over stdio or Streamable HTTP

Options:
  --http            Start Streamable HTTP server (127.0.0.1, default port 8808)
  --port <port>     HTTP port (with --http)
  -V, --version     Output the version number
  -h, --help        Display help for command`);
}

if (hasFlag("--help") || hasFlag("-h")) {
  printHelp();
  process.exit(0);
}

if (hasFlag("--version") || hasFlag("-V")) {
  console.log(pkg.version);
  process.exit(0);
}

loadConnectorVersions();

async function main() {
  const argv = process.argv.slice(2);

  if (isStdioMode(argv)) {
    const server = buildServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    return;
  }

  // Default: shared Streamable HTTP server (one process per MCP, many agents).
  const port = resolveHttpPort(argv);
  const { port: boundPort } = await startMcpHttpServer(port);
  console.error(`connectors-mcp HTTP listening on http://127.0.0.1:${boundPort}/mcp`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

export { buildServer } from "./server.js";
