#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { isStdioMode, resolveHttpPort, startHttpServer } from "./http.js";
import { buildServer, getPackageVersion } from "./server.js";

export { buildServer, getPackageVersion } from "./server.js";
export { isHttpMode, resolveHttpPort, startHttpServer, DEFAULT_HTTP_PORT, HTTP_NAME } from "./http.js";

export function getMcpHelpText(): string {
  return [
    "Usage: markdown-mcp [options]",
    "",
    "OMP MCP Server — stdio transport for OMP tools",
    "",
    "Options:",
    "  --http              Start Streamable HTTP transport on 127.0.0.1 (or MCP_HTTP=1)",
    "  --port <n>          HTTP port (default: 8822, or MCP_HTTP_PORT env)",
    "  -v, --version       Output version",
    "  -h, --help          Display help",
  ].join("\n");
}

export function handleMcpCliArgs(args: string[], log: (msg: string) => void = console.log): boolean {
  if (args.includes("-h") || args.includes("--help")) {
    log(getMcpHelpText());
    return true;
  }

  if (args.includes("-v") || args.includes("--version")) {
    log(getPackageVersion());
    return true;
  }

  return false;
}

export async function main(args: string[] = process.argv.slice(2)) {
  if (handleMcpCliArgs(args)) return;

  if (isStdioMode(args)) {
    const server = buildServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    return;
  }
  // Default: shared Streamable HTTP server (one process per MCP, many agents).
  startHttpServer({ port: resolveHttpPort(args) });
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
