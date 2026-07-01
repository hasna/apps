import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ChangelogStore } from "../types.js";
import { VERSION } from "../version.js";
import { registerChangelogMcpTools } from "./tools.js";

export interface CreateChangelogMcpServerOptions {
  name?: string;
  version?: string;
  store?: ChangelogStore;
}

export function createChangelogMcpServer(options: CreateChangelogMcpServerOptions = {}): McpServer {
  const server = new McpServer({
    name: options.name ?? "changelog",
    version: options.version ?? VERSION,
  });
  registerChangelogMcpTools(server, options.store);
  return server;
}

export function buildServer(options: CreateChangelogMcpServerOptions = {}): McpServer {
  return createChangelogMcpServer(options);
}

