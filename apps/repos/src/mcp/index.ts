#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer, prepareMcpLifecycle, VERSION } from "./server.js";
import { isHttpMode, resolveMcpHttpPort, startMcpHttpServer } from "./http.js";

function handleCliFlags(argv: string[]): boolean {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("Usage: repos-mcp [options]");
    console.log("");
    console.log("MCP server for @hasna/repos (stdio default, optional Streamable HTTP)");
    console.log("");
    console.log("Options:");
    console.log("  --http         Start Streamable HTTP transport on 127.0.0.1");
    console.log("  --port <n>     HTTP port (default 8830, or MCP_HTTP_PORT env)");
    console.log("  -h, --help     display help");
    console.log("  -V, --version  display version");
    console.log("");
    console.log("Environment:");
    console.log("  MCP_HTTP=1         Enable HTTP mode");
    console.log("  MCP_HTTP_PORT      Override default HTTP port");
    return true;
  }

  if (argv.includes("--version") || argv.includes("-V")) {
    console.log(VERSION);
    return true;
  }

  return false;
}

const argv = process.argv.slice(2);
if (handleCliFlags(argv)) {
  process.exit(0);
}

async function main() {
  await prepareMcpLifecycle();

  if (isHttpMode(argv)) {
    startMcpHttpServer({ port: resolveMcpHttpPort(argv) });
    return;
  }

  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
