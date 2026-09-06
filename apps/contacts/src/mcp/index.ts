#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerContactsTools } from "./register-tools.js";
import { registerContactsStorageTools } from "./storage-tools.js";
import { isHttpMode, resolveMcpHttpPort, startMcpHttpServer } from "./http.js";

function getServerVersion(): string {
  try {
    const packageJsonPath = join(import.meta.dir, "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function buildServer(): McpServer {
  const server = new McpServer({ name: "contacts", version: getServerVersion() });
  registerContactsTools(server);
  registerContactsStorageTools(server);
  return server;
}

/**
 * Classify early-exit arguments before any http-mode parse, server build, or
 * stdio bind. `--help` / `--version` answer with rc=0 and the MCP server never
 * starts: previously `contacts-mcp --version` fell through to the stdio
 * JSON-RPC loop and printed "running on stdio" instead of the version
 * (hasna/apps#1720 validation, the binds-before-version class).
 */
export function handleEarlyArgs(argv: string[]): "help" | "version" | "start" {
  if (argv.includes("--help") || argv.includes("-h")) return "help";
  if (argv.includes("--version") || argv.includes("-V")) return "version";
  return "start";
}

export function mcpUsage(): string {
  return `usage: contacts-mcp                       MCP server over stdio (default)
       contacts-mcp --http [--port <n>]   Streamable-HTTP dev server (loopback)
       contacts-mcp --version             Print the version

options:
  --help, -h          show this help and exit
  --version, -V       print the package version and exit
`;
}

async function main() {
  const args = process.argv.slice(2);
  const early = handleEarlyArgs(args);
  if (early === "help") {
    console.log(mcpUsage());
    return;
  }
  if (early === "version") {
    console.log(getServerVersion());
    return;
  }

  if (isHttpMode(args)) {
    startMcpHttpServer({
      name: "contacts",
      port: resolveMcpHttpPort(args),
      buildServer,
    });
    return;
  }

  const transport = new StdioServerTransport();
  await buildServer().connect(transport);
  console.error("Contacts MCP server running on stdio");
}

export function isDirectMcpEntry(entry = process.argv[1]): boolean {
  if (!entry) return false;
  const normalized = entry.replaceAll("\\", "/");
  return normalized.endsWith("/mcp/index.ts") || normalized.endsWith("/mcp/index.js");
}

if (isDirectMcpEntry()) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
