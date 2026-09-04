#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import pkg from "../../package.json";
import { buildServer } from "./server.js";
import { DEFAULT_MCP_HTTP_PORT, isStdioMode, parseCliPort, startMcpHttpServer } from "./http.js";
import { getStore } from "../lib/store/index.js";

function printHelp(): void {
  console.log(`Usage: telephony-mcp [options]

Runs the @hasna/telephony MCP server.

Options:
  -V, --version    output the version number
  -h, --help       display help for command
      --http       start Streamable HTTP transport on 127.0.0.1 (env: MCP_HTTP=1)
      --port <n>   HTTP port (default ${DEFAULT_MCP_HTTP_PORT}, env: MCP_HTTP_PORT)`);
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
  // Fail-closed gate (owner directive 2026-09-04): every telephony-mcp tool
  // reads/writes through the Store. Without the fleet API env
  // (HASNA_TELEPHONY_API_URL + HASNA_TELEPHONY_API_KEY) AND without the
  // explicit local opt-in (HASNA_TELEPHONY_LOCAL=1) the server refuses to
  // start with an actionable error — it never silently serves the on-box
  // SQLite store.
  try {
    getStore();
  } catch (error) {
    console.error(`telephony-mcp: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  if (isStdioMode(args)) {
    const server = buildServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    return;
  }
  // Default: shared Streamable HTTP server (one process per MCP, many agents).
  await startMcpHttpServer({ name: "telephony", port: parseCliPort(args) });
}

main().catch((error) => {
  console.error("Failed to start telephony-mcp:", error);
  process.exit(1);
});
