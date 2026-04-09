#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerCloudTools } from "@hasna/cloud";
import { registerContactsTools } from "./register-tools.js";

function getServerVersion(): string {
  try {
    const packageJsonPath = join(import.meta.dir, "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const server = new McpServer({ name: "contacts", version: getServerVersion() });

registerContactsTools(server);

async function main() {
  const transport = new StdioServerTransport();
  registerCloudTools(server, "contacts");
  await server.connect(transport);
  console.error("Contacts MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
