import { registerCloudTools } from "@hasna/cloud";
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
  cloudTools?: boolean;
  tools?: McpsMcpToolDefinition[];
}

export function createMcpServer(options: CreateMcpServerOptions = {}): McpServer {
  const server = new McpServer({
    name: options.name ?? "mcps",
    version: options.version ?? VERSION,
  });

  registerMcpTools(server, options.tools);

  if (options.cloudTools !== false) {
    registerCloudTools(server, "mcps");
  }

  return server;
}
