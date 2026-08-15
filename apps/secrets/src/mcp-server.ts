#!/usr/bin/env bun
/**
 * secrets-mcp bin entrypoint. Defaults to stdio (the MCP transport agents use);
 * pass `--http [--port N]` for the Streamable HTTP transport.
 */
import { buildServer, startMcpServer } from "./mcp.js";
import { isHttpMode, resolveMcpHttpPort, startMcpHttpServer } from "./mcp-http.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
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
