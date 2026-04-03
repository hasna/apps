/**
 * Claude Code channel bridge for conversations MCP server.
 *
 * Two messaging modes:
 *   1. Direct inject (send_to_session) — targets session ID, auto-injected
 *      via channel notification, auto-marked as read
 *   2. DM (send_message) — targets agent name, sits in inbox unread
 *      until the agent checks, also injected if agent is online
 *
 * The bridge figures out who it is from:
 *   - The agent that registered/heartbeated in this MCP session
 *   - The CONVERSATIONS_SESSION_ID env var (set by agent-claude)
 *   - Falls back to CONVERSATIONS_AGENT_ID if set
 *
 * No manual config needed — just connect and go.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readMessages, markReadByIds } from "../lib/messages.js";

const POLL_INTERVAL_MS = 1000;

// Track the agent identity registered in this MCP session
let sessionAgentId: string | null = null;

/** Called by agent tools when register_agent or heartbeat fires */
export function setSessionAgent(agentId: string): void {
  sessionAgentId = agentId;
  // Also update the identity system so outgoing messages use this name
  try {
    const { updateCachedAutoName } = require("../lib/identity.js");
    updateCachedAutoName(agentId);
  } catch { /* ok */ }
}

export function getSessionAgent(): string | null {
  return sessionAgentId || process.env.CONVERSATIONS_AGENT_ID || null;
}

export function registerChannelBridge(server: McpServer): void {
  server.server.registerCapabilities({
    experimental: { 'claude/channel': {} },
  });

  let lastAgentMsgId = 0;
  let lastSessionMsgId = 0;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  function getSessionId(): string | null {
    return process.env.CONVERSATIONS_SESSION_ID || null;
  }

  function seedLastSeen(): void {
    const agent = getSessionAgent();
    const sid = getSessionId();

    if (agent) {
      const latest = readMessages({ to: agent, order: "desc", limit: 1 });
      if (latest.length > 0) lastAgentMsgId = latest[0].id;
    }
    if (sid) {
      const latest = readMessages({ to: `session:${sid}`, order: "desc", limit: 1 });
      if (latest.length > 0) lastSessionMsgId = latest[0].id;
    }
  }

  function pushNotification(msg: {
    id: number;
    content: string;
    from_agent: string;
    session_id: string;
    space?: string | null;
    priority?: string;
  }, isDirect: boolean): void {
    // Direct session messages are auto-marked as read
    if (isDirect) {
      try { markReadByIds([msg.id]); } catch { /* ok */ }
    }

    // Rich context for the receiving agent
    const context = [
      `From: ${msg.from_agent}`,
      `Mode: ${isDirect ? 'direct (auto-injected, auto-read)' : 'dm (passive, check inbox)'}`,
      `Message ID: ${msg.id}`,
      msg.space ? `Space: ${msg.space}` : null,
      msg.priority && msg.priority !== 'normal' ? `Priority: ${msg.priority}` : null,
    ].filter(Boolean).join(' | ');

    const enrichedContent = `[${context}]\n${msg.content}`;

    server.server.notification({
      method: "notifications/claude/channel",
      params: {
        content: enrichedContent,
        meta: {
          from: msg.from_agent,
          message_id: String(msg.id),
          session_id: msg.session_id,
          mode: isDirect ? "direct" : "dm",
          ...(msg.space ? { space: msg.space } : {}),
          ...(msg.priority && msg.priority !== "normal" ? { priority: msg.priority } : {}),
        },
      },
    }).catch(() => { /* transport not ready or disconnected */ });
  }

  function startPolling(): void {
    if (pollTimer) return;
    seedLastSeen();

    pollTimer = setInterval(() => {
      try {
        const agent = getSessionAgent();
        const sid = getSessionId();

        // Poll DMs to this agent — skip messages FROM self (no echoes)
        if (agent) {
          const msgs = readMessages({ to: agent, order: "asc", limit: 20 })
            .filter(m => m.id > lastAgentMsgId && m.from_agent !== agent);
          for (const msg of msgs) {
            lastAgentMsgId = msg.id;
            pushNotification(msg, false);
          }
        }

        // Poll direct session-targeted messages — skip self (no echoes)
        if (sid) {
          const msgs = readMessages({ to: `session:${sid}`, order: "asc", limit: 20 })
            .filter(m => m.id > lastSessionMsgId && m.from_agent !== agent);
          for (const msg of msgs) {
            lastSessionMsgId = msg.id;
            pushNotification(msg, true);
          }
        }
      } catch { /* silently continue */ }
    }, POLL_INTERVAL_MS);
  }

  // Start polling after connection established
  setTimeout(() => startPolling(), 2000);
}
