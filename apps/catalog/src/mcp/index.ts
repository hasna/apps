#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CatalogStoreLike } from "../types.js";
import { VERSION } from "../version.js";
import { registerCatalogMcpTools } from "./tools.js";

export { registerCatalogMcpTools } from "./tools.js";

export interface CreateCatalogMcpServerOptions {
  name?: string;
  version?: string;
  store?: CatalogStoreLike;
}

export function createCatalogMcpServer(options: CreateCatalogMcpServerOptions = {}): McpServer {
  const server = new McpServer({
    name: options.name ?? "catalog",
    version: options.version ?? VERSION,
  });
  registerCatalogMcpTools(server, options.store);
  return server;
}

export async function main(): Promise<void> {
  const server = createCatalogMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.main) {
  await main();
}
