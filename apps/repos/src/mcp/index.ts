#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer, prepareMcpLifecycle, VERSION } from "./server.js";
import { isStdioMode, resolveMcpHttpPort, startMcpHttpServer } from "./http.js";
import { resolveReposMcpProfile } from "./profile.js";

function handleCliFlags(argv: string[]): boolean {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("Usage: repos-mcp [options]");
    console.log("");
    console.log("MCP server for @hasna/repos (Streamable HTTP default, optional stdio)");
    console.log("");
    console.log("Options:");
    console.log("  --http         Start Streamable HTTP transport on 127.0.0.1 (default)");
    console.log("  --stdio        Use stdio transport instead of HTTP");
    console.log("  --port <n>     HTTP port (default 8874, or MCP_HTTP_PORT env)");
    console.log("  --mcp-profile <core|full>  Tool inventory profile (default core)");
    console.log("  -h, --help     display help");
    console.log("  -V, --version  display version");
    console.log("");
    console.log("Environment:");
    console.log("  MCP_HTTP=1         Select HTTP mode explicitly");
    console.log("  MCP_STDIO=1        Select stdio mode");
    console.log("  MCP_HTTP_PORT      Override the default HTTP port");
    console.log("  HASNA_REPOS_MCP_PROFILE=full  Restore the legacy complete tool inventory");
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
  const profile = resolveReposMcpProfile(argv);
  await prepareMcpLifecycle();

  if (isStdioMode(argv)) {
    const server = buildServer(profile);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    return;
  }
  // Default: shared Streamable HTTP server (one process per MCP, many agents).
  startMcpHttpServer({ port: resolveMcpHttpPort(argv), profile });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
