#!/usr/bin/env bun
/**
 * MCP server for conversations.
 * Exposes tools for sending, reading, and managing messages, spaces, and projects between agents.
 *
 * Usage:
 *   conversations mcp          # Start MCP server on stdio (40+ tools)
 *   conversations-mcp          # Direct binary
 *   conversations-mcp --http   # Streamable HTTP on 127.0.0.1:8856
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getPresence } from "../lib/presence.js";

import { registerMessagingTools } from "./tools/messaging.js";
import { registerSpaceTools } from "./tools/spaces.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerAgentTools } from "./tools/agents.js";
import { registerAdvancedTools } from "./tools/advanced.js";
import { registerCloudSyncTools } from "./tools/cloud.js";
import { registerChannelBridge } from "./channel.js";
import { registerTelegramChannel } from "./telegram-channel.js";
import { registerTmuxTools } from "./tools/tmux.js";
import { registerTaskTools } from "./tools/tasks.js";
import { isStdioMode, resolveMcpHttpPort, startMcpHttpServer } from "./http.js";

import pkg from "../../package.json";

// ---- Focus Mode (session-level, in-memory) ----
// Priority: per-call param > session focus > agent_presence.project_id > no filter
const agentFocus = new Map<string, { project_id: string | null }>();

function getAgentFocus(agentId: string): string | null {
  if (agentFocus.has(agentId)) return agentFocus.get(agentId)!.project_id;
  const presence = getPresence(agentId);
  return presence?.project_id ?? null;
}

function resolveProjectId(explicitProjectId: string | undefined, agentId: string): string | undefined {
  if (explicitProjectId) return explicitProjectId;
  const focused = getAgentFocus(agentId);
  return focused ?? undefined;
}

export function buildServer(forHttp = false): McpServer {
  const srv = new McpServer({
    name: "conversations",
    version: pkg.version,
  });

  registerMessagingTools(srv, resolveProjectId);
  registerSpaceTools(srv);
  registerProjectTools(srv);
  registerAgentTools(srv, agentFocus, getAgentFocus);
  registerAdvancedTools(srv, pkg.version);
  registerTaskTools(srv);
  registerTmuxTools(srv);
  registerCloudSyncTools(srv);

  if (!forHttp) {
    registerChannelBridge(srv);
    registerTelegramChannel(srv);
  }

  return srv;
}

export const server = buildServer();

export async function startMcpServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("mcp.js") ||
  process.argv[1]?.endsWith("mcp.ts");

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`conversations-mcp — MCP server for @hasna/conversations v${pkg.version}

Usage:
  conversations-mcp              stdio transport (default)
  conversations-mcp --http         Streamable HTTP on 127.0.0.1:8856
  conversations-mcp --http --port <n>

Environment:
  MCP_HTTP=1           Enable HTTP mode
  MCP_HTTP_PORT=<n>    Override default port (8856)
`);
    return;
  }
  if (args.includes("--version") || args.includes("-V")) {
    console.log(pkg.version);
    return;
  }
  if (isStdioMode(args)) {
    await startMcpServer();
    return;
  }
  // Default: shared Streamable HTTP server (one process per MCP, many agents).
  startMcpHttpServer({
    name: "conversations",
    port: resolveMcpHttpPort(args),
    buildServer: () => buildServer(true),
  });
}

if (isDirectRun) {
  main().catch((error) => {
    console.error("MCP server error:", error);
    process.exit(1);
  });
}
