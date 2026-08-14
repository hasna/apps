#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getPackageVersion } from "../version.js";
import { isHttpMode, resolveHttpPort, startHttpServer } from "./http.js";
import { buildServer } from "./server.js";

function printHelp(): void {
  console.log(`Usage: machines-mcp [options]

MCP server for machine fleet management tools (stdio transport by default)

Options:
  --http         Start Streamable HTTP transport on 127.0.0.1 (or MCP_HTTP=1)
  --port <n>     HTTP port (default: 8821, or MCP_HTTP_PORT env)
  -V, --version  output the version number
  -h, --help     display help for command`);
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

if (args.includes("--version") || args.includes("-V")) {
  console.log(getPackageVersion());
  process.exit(0);
}

if (isHttpMode(args)) {
  startHttpServer({ port: resolveHttpPort(args) });
} else {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
