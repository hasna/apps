#!/usr/bin/env bun
/**
 * secrets-mcp bin entrypoint. Defaults to stdio (the MCP transport agents use);
 * pass `--http [--port N]` for the Streamable HTTP transport.
 */
import { buildServer, startMcpServer } from "./mcp.js";
import { isHttpMode, resolveMcpHttpPort, startMcpHttpServer, DEFAULT_MCP_HTTP_PORT } from "./mcp-http.js";
import { VERSION } from "./version.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  // Binds-before-help class (todos row afd9e358): --help/--version must answer
  // BEFORE any transport is resolved or connected. They previously fell through
  // to startMcpServer(), entered MCP stdio mode, printed nothing, and exited
  // rc=0 silently when stdin closed.
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`Usage: secrets-mcp [options]

MCP server for @hasna/secrets

Options:
  -V, --version  output the version number
  -h, --help     display help for command
  --http         explicitly select Streamable HTTP transport
  --port <n>     HTTP port (default: ${DEFAULT_MCP_HTTP_PORT})

Set MCP_HTTP=1 (or pass --http) to serve over Streamable HTTP;
MCP_HTTP_PORT sets its port. The default is stdio for MCP clients.`);
    process.exit(0);
  }
  if (args.includes("--version") || args.includes("-V")) {
    console.log(VERSION);
    process.exit(0);
  }
  if (isHttpMode(args)) {
    startMcpHttpServer({ name: "secrets", port: resolveMcpHttpPort(args), buildServer });
    await new Promise<never>(() => {});
    return;
  }
  await startMcpServer();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
