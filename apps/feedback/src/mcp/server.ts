import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FeedbackStore } from "../types.js";
import { VERSION } from "../version.js";
import { registerFeedbackMcpTools } from "./tools.js";

export interface CreateFeedbackMcpServerOptions {
  name?: string;
  version?: string;
  store?: FeedbackStore;
}

export function createFeedbackMcpServer(options: CreateFeedbackMcpServerOptions = {}): McpServer {
  const server = new McpServer({
    name: options.name ?? "feedback",
    version: options.version ?? VERSION,
  });
  registerFeedbackMcpTools(server, options.store);
  return server;
}

export function buildServer(options: CreateFeedbackMcpServerOptions = {}): McpServer {
  return createFeedbackMcpServer(options);
}

