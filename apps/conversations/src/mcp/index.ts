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
import { ConversationsStoreConfigError, assertUnambiguousStoreEnv, getStore } from "../lib/store/index.js";

import { registerMessagingTools } from "./tools/messaging.js";
import { registerChannelTools } from "./tools/channels.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerAgentTools } from "./tools/agents.js";
import { registerAdvancedTools } from "./tools/advanced.js";
import { registerChannelBridge } from "./channel.js";
import { registerTelegramChannel } from "./telegram-channel.js";
import { registerTmuxTools } from "./tools/tmux.js";
import { registerTaskTools } from "./tools/tasks.js";
import { registerThreadTools } from "./tools/threads.js";
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
const serverDrains = new WeakMap<McpServer, Promise<void>>();

/**
 * Stop the background loops owned by a server built here, and wait until they
 * are quiescent. Safe to call twice, and a no-op for a server with no loops
 * (an HTTP server registers none). Production stdio keeps the singleton alive
 * for the life of the process, exactly as before; this is for callers that
 * build their own server and outlive it.
 */
export async function disposeServer(srv: McpServer): Promise<void> {
  const existing = serverDrains.get(srv);
  if (existing) return existing;
  const disposers = serverDisposers.get(srv);
  if (!disposers) return;
  serverDisposers.delete(srv);
  const drain = Promise.allSettled(disposers.map((dispose) => dispose())).then(() => {});
  serverDrains.set(srv, drain);
  try { await drain; } finally { serverDrains.delete(srv); }
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
  registerThreadTools(srv);

  if (!forHttp) {
    // Building/importing a tool registry must not start account reads. Register
    // capabilities immediately before connecting, then own and drain the loops.
    let connectionAttempted = false;
    const connect = srv.connect.bind(srv);
    const close = srv.close.bind(srv);
    const onclose = srv.server.onclose;
    srv.server.onclose = () => {
      void disposeServer(srv);
      onclose?.();
    };
    srv.connect = async (...args: Parameters<McpServer["connect"]>) => {
      if (connectionAttempted) throw new Error("MCP stdio server instances support one transport connection; build a new server to reconnect.");
      connectionAttempted = true;
      try {
        await serverDrains.get(srv);
        if (!serverDisposers.has(srv)) {
          const disposers: Array<() => Promise<void>> = [];
          serverDisposers.set(srv, disposers);
          disposers.push(registerChannelBridge(srv));
          disposers.push(registerTelegramChannel(srv));
        }
        await connect(...args);
      } catch (error) { await disposeServer(srv); throw error; }
    };
    srv.close = async () => {
      const drain = disposeServer(srv);
      try { await close(); } finally { await drain; }
    };
  }

  return srv;
}

export const server = buildServer();

/**
 * FAIL CLOSED BEFORE SERVING (owner ruling 2026-09-04, hasna/apps#1720
 * acceptance (c); the same gate @hasna/mementos received in #1868).
 *
 * Until now nothing evaluated the store selection before `server.connect`:
 * every tool call resolved the store fresh and refused on its own, so a
 * hosted station with no credential got an MCP server that answered
 * `initialize`, advertised 40+ tools, and returned an `isError` result for
 * each of them — fail-loud PER CALL, never fail-closed. A coding agent that
 * registered `conversations-mcp` without a credential saw a healthy server
 * and a wall of tool errors instead of one startup refusal naming the fix.
 *
 * Shared account configuration is checked before either transport connects.
 * Retired database selectors and missing credentials fail without opening a
 * database. Each tool re-resolves credentials so revocation remains effective.
 */
export function assertMcpStoreConfigured(env: Record<string, string | undefined> = process.env): void {
  assertUnambiguousStoreEnv(env);
}

async function connectStdio(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/**
 * Start the stdio server for the CLI's `conversations mcp` subcommand. The
 * startup gate throws rather than exiting so the CLI's own error surface
 * (and its `--json` error contract) reports the refusal.
 */
export async function startMcpServer() {
  assertMcpStoreConfigured();
  await connectStdio();
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
  // The startup gate runs BEFORE either transport exists, so a hosted run
  // with no credential exits non-zero without ever answering `initialize`
  // (stdio) or binding a port (HTTP). The refusal is the chain's own message
  // on stderr — tier names and the local opt-in, never a value — and the
  // exit code is 1, the same contract the CLI's error surface honours.
  try {
    assertMcpStoreConfigured();
  } catch (error) {
    if (error instanceof ConversationsStoreConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
  if (isStdioMode(args)) {
    await connectStdio();
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
