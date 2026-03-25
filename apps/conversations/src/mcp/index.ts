#!/usr/bin/env bun
/**
 * MCP server for conversations.
 * Exposes tools for sending, reading, and managing messages, spaces, and projects between agents.
 *
 * Usage:
 *   conversations mcp          # Start MCP server on stdio
 *   conversations-mcp          # Direct binary
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerCloudTools } from "@hasna/cloud";
import { getPresence } from "../lib/presence.js";

import { registerMessagingTools } from "./tools/messaging.js";
import { registerSpaceTools } from "./tools/spaces.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerAgentTools } from "./tools/agents.js";
import { registerAdvancedTools } from "./tools/advanced.js";

import pkg from "../../package.json";

export const server = new McpServer({
  name: "conversations",
  version: pkg.version,
});

// ---- Focus Mode (session-level, in-memory) ----
// Priority: per-call param > session focus > agent_presence.project_id > no filter
const agentFocus = new Map<string, { project_id: string | null }>();

function getAgentFocus(agentId: string): string | null {
  if (agentFocus.has(agentId)) return agentFocus.get(agentId)!.project_id;
  // Fall back to DB-stored active project
  const presence = getPresence(agentId);
  return presence?.project_id ?? null;
}

function resolveProjectId(explicitProjectId: string | undefined, agentId: string): string | undefined {
  if (explicitProjectId) return explicitProjectId;
  const focused = getAgentFocus(agentId);
  return focused ?? undefined;
}

// ---- Register all tool groups ----
registerMessagingTools(server, resolveProjectId);
registerSpaceTools(server);
registerProjectTools(server);
registerAgentTools(server, agentFocus, getAgentFocus);
registerAdvancedTools(server, pkg.version);

// ---- Start server ----

export async function startMcpServer() {
  const transport = new StdioServerTransport();
  registerCloudTools(server, "conversations");
  await server.connect(transport);
}

// If run directly (not imported)
const isDirectRun = import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("mcp.js") ||
  process.argv[1]?.endsWith("mcp.ts");

if (isDirectRun) {
  startMcpServer().catch((error) => {
    console.error("MCP server error:", error);
    process.exit(1);
  });
}
