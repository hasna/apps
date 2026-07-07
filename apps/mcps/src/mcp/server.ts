import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readPackageVersion } from "../lib/version.js";
import {
  registerMcpTools,
  type McpsMcpToolDefinition,
} from "./tools.js";

export const VERSION = readPackageVersion(import.meta.url);

export interface CreateMcpServerOptions {
  name?: string;
  version?: string;
  tools?: McpsMcpToolDefinition[];
}

export function buildServer(options: CreateMcpServerOptions = {}): McpServer {
  return createMcpServer(options);
}

export function createMcpServer(options: CreateMcpServerOptions = {}): McpServer {
  const server = new McpServer({
    name: options.name ?? "mcps",
    version: options.version ?? VERSION,
  });

  registerMcpTools(server, options.tools);

  return server;
}
