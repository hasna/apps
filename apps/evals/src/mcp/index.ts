#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import pkg from "../../package.json" with { type: "json" };
import { buildServer } from "./server.js";
import { isStdioMode, resolveHttpPort, startHttpServer } from "./http.js";

function printHelp(): void {
  console.log(`Usage: evals-mcp [options]

Runs the @hasna/evals MCP server (Streamable HTTP by default).

Options:
      --http         Serve MCP over Streamable HTTP on 127.0.0.1 (default)
      --stdio        Serve MCP over stdio instead of HTTP
  -p, --port <port>  HTTP port (default: MCP_HTTP_PORT or 8862)
  -V, --version      output the version number
  -h, --help         display help for command

Environment:
  MCP_HTTP=1         Enable HTTP mode
  MCP_STDIO=1        Enable stdio mode
  MCP_HTTP_PORT      Override default HTTP port (8862)`);
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

if (args.includes("--version") || args.includes("-V")) {
  console.log(pkg.version);
  process.exit(0);
}

async function main(): Promise<void> {
  if (isStdioMode(args)) {
    const server = buildServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    return;
  }
  // Default: shared Streamable HTTP server (one process per MCP, many agents).
  startHttpServer({ port: resolveHttpPort(args) });
  await new Promise<never>(() => {});
}

main().catch((error) => {
  console.error("MCP server error:", error);
  process.exit(1);
});
