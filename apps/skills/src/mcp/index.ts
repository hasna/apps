#!/usr/bin/env bun
/**
 * MCP server for the skills library.
 * Exposes tools for listing, searching, pinning, and running skills.
 *
 * Usage:
 *   skills mcp          # Start MCP server on stdio
 *   skills-mcp          # Direct binary
 *   skills-mcp --http   # Streamable HTTP on 127.0.0.1:8836
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import pkg from "../../package.json" with { type: "json" };

import { buildServer } from "./server.js";
import { isMcpStdioMode, parseMcpHttpPort, startSkillsMcpHttpServer } from "./http.js";

const args = process.argv.slice(2);

function printHelp(): void {
  console.log(`Usage: skills-mcp [options]

MCP server for ${pkg.name}

Options:
  -V, --version  output the version number
  -h, --help     display help for command
  --stdio        run newline-delimited JSON-RPC for agent hosts
  --http         run Streamable HTTP transport on 127.0.0.1 (default; port 8836)
  --port <n>     HTTP port (--http or MCP_HTTP=1)`);
}

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

if (args.includes("--version") || args.includes("-V")) {
  console.log(pkg.version);
  process.exit(0);
}

/**
 * Start the Skills MCP server on stdio (newline-delimited JSON-RPC).
 *
 * Exported so the `skills mcp` CLI subcommand can start the server directly:
 * a bare dynamic import of this module is inert, because `import.meta.main`
 * is false when the module is not the process entry point — which made
 * `skills mcp` exit rc=0 with zero bytes instead of starting the documented
 * stdio server (BUG e3997558).
 */
export async function startMcpStdio(): Promise<void> {
  const server = buildServer();
  await server.connect(new StdioServerTransport());
}

async function main() {
  if (isMcpStdioMode(args)) {
    await startMcpStdio();
    return;
  }
  // Default: shared Streamable HTTP server (one process per MCP, many agents).
  const port = parseMcpHttpPort(args);
  await startSkillsMcpHttpServer({ port, hostname: "127.0.0.1" });
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("MCP server error:", error);
    process.exit(1);
  });
}

export { buildServer } from "./server.js";
