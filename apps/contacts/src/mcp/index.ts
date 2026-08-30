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

async function main() {
  const args = process.argv.slice(2);
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
