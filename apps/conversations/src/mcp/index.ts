#!/usr/bin/env bun
/**
 * MCP server for conversations.
 * Exposes tools for sending, reading, and managing messages, channels, and projects between agents.
 *
 * Usage:
 *   conversations mcp          # Start MCP server on stdio (40+ tools)
 *   conversations-mcp          # Direct binary
 *   conversations-mcp --http   # Streamable HTTP on 127.0.0.1:8856
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getStore } from "../lib/store/index.js";

import { registerMessagingTools } from "./tools/messaging.js";
import { registerChannelTools } from "./tools/channels.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerAgentTools } from "./tools/agents.js";
import { registerAdvancedTools } from "./tools/advanced.js";
import { registerChannelBridge } from "./channel.js";
import { registerTelegramChannel } from "./telegram-channel.js";
import { registerTmuxTools } from "./tools/tmux.js";
import { registerTaskTools } from "./tools/tasks.js";
import { isStdioMode, resolveMcpHttpPort, startMcpHttpServer } from "./http.js";

import pkg from "../../package.json";

// ---- Focus Mode (session-level, in-memory) ----
// Priority: per-call param > session focus > agent_presence.project_id > no filter
const agentFocus = new Map<string, { project_id: string | null }>();

async function getAgentFocus(agentId: string): Promise<string | null> {
  if (agentFocus.has(agentId)) return agentFocus.get(agentId)!.project_id;
  // Route presence through the Store so the hosted API reads cloud presence,
  // not stale local sqlite.
  const presence = await getStore().getPresence(agentId);
  return presence?.project_id ?? null;
}

async function resolveProjectId(explicitProjectId: string | undefined, agentId: string): Promise<string | undefined> {
  if (explicitProjectId) return explicitProjectId;
  const focused = await getAgentFocus(agentId);
  return focused ?? undefined;
}

/**
 * Disposers for the background loops a server owns, keyed by that server.
 *
 * `buildServer` returns an `McpServer` — `http.ts` and `serve.ts` both pass it
 * as `() => McpServer` — so the channel bridge's disposer had nowhere to go and
 * was unreachable by construction. Every stdio server ever built kept polling
 * for the life of the process; under `bun test`, where one process runs every
 * file, the bridges made by tool-contract, http and envelope-ordering polled on
 * through later files (todos 890b269e). Keeping the disposers beside the server
 * rather than in its return type lets a caller close what it created without
 * changing the shape every other caller depends on.
 */
const serverDisposers = new WeakMap<McpServer, Array<() => Promise<void>>>();

/**
 * Stop the background loops owned by a server built here, and wait until they
 * are quiescent. Safe to call twice, and a no-op for a server with no loops
 * (an HTTP server registers none). Production stdio keeps the singleton alive
 * for the life of the process, exactly as before; this is for callers that
 * build their own server and outlive it.
 */
export async function disposeServer(srv: McpServer): Promise<void> {
  const disposers = serverDisposers.get(srv);
  if (!disposers) return;
  serverDisposers.delete(srv);
  await Promise.allSettled(disposers.map((dispose) => dispose()));
}

export function buildServer(forHttp = false): McpServer {
  const srv = new McpServer({
    name: "conversations",
    version: pkg.version,
  });

  registerMessagingTools(srv, resolveProjectId);
  registerChannelTools(srv);
  registerProjectTools(srv);
  registerAgentTools(srv, agentFocus, getAgentFocus);
  registerAdvancedTools(srv, pkg.version);
  registerTaskTools(srv);
  registerTmuxTools(srv);

  if (!forHttp) {
    serverDisposers.set(srv, [registerChannelBridge(srv)]);
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
