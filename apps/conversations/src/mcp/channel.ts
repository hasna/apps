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
import { getStore } from "../lib/store/index.js";
// Routed reads/writes: every read/write goes through the Store (local or cloud API).

const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_START_DELAY_MS = 2000;

// Track agent identity and session for this MCP connection
let sessionAgentId: string | null = null;
let sessionClaudeId: string | null = null; // agent-claude session UUID

/** Called by agent tools when register_agent or heartbeat fires */
export function setSessionAgent(agentId: string, claudeSessionId?: string): void {
  sessionAgentId = agentId;
  if (claudeSessionId) sessionClaudeId = claudeSessionId;
  try {
    const { updateCachedAutoName } = require("../lib/identity.js");
    updateCachedAutoName(agentId);
  } catch { /* ok */ }
}

/** Called by register_agent to store the claude session ID */
export function setClaudeSessionId(id: string): void {
  sessionClaudeId = id;
}

export function getSessionAgent(): string | null {
  return sessionAgentId || process.env.CONVERSATIONS_AGENT_ID || null;
}

export function getClaudeSessionId(): string | null {
  return sessionClaudeId || process.env.CONVERSATIONS_SESSION_ID || null;
}

export function registerChannelBridge(
  server: McpServer,
  opts?: { pollIntervalMs?: number; startDelayMs?: number },
): () => void {
  server.server.registerCapabilities({
    experimental: { 'claude/channel': {} },
  });

  const pollIntervalMs = opts?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const startDelayMs = opts?.startDelayMs ?? DEFAULT_START_DELAY_MS;
  let lastAgentMsgId = 0;
  let lastSessionMsgId = 0;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let startTimer: ReturnType<typeof setTimeout> | null = null;
  let polling = false;

  function getSessionId(): string | null {
    return getClaudeSessionId();
  }

  async function pushNotification(msg: {
    id: number;
    content: string;
    from_agent: string;
    session_id: string;
    channel?: string | null;
    priority?: string;
  }, mode: "direct" | "dm" | "channel_blurb"): Promise<boolean> {
    const enrichedContent = mode === "channel_blurb"
      ? `${msg.from_agent} posted in #${msg.channel}: ${msg.content}\n\n---\n[Preview only for channel message #${msg.id}. To inspect the full message later, call get_message with id=${msg.id} or run conversations show ${msg.id}.]`
      : `${msg.content}\n\n---\n[Via Conversations from ${msg.from_agent} (msg #${msg.id}). To reply, use conversations send_message with to="${msg.from_agent}". For direct session injection, use send_to_session with target_session_id from the sender's session.]`;

    try {
      await server.server.notification({
        method: "notifications/claude/channel",
        params: {
          content: enrichedContent,
          meta: {
            from: msg.from_agent,
            message_id: String(msg.id),
            session_id: msg.session_id,
            mode,
            ...(msg.channel ? { channel: msg.channel } : {}),
            ...(msg.priority && msg.priority !== "normal" ? { priority: msg.priority } : {}),
          },
        },
      });

      // Only acknowledge delivery after the channel transport accepts it.
      if (mode === "direct") {
        try { await await getStore().markReadByIds([msg.id]); } catch { /* ok */ }
      } else if (mode === "channel_blurb") {
        const agent = getSessionAgent();
        if (agent) {
          try { await getStore().markChannelNotificationsRead(agent, [msg.id]); } catch { /* ok */ }
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  async function pollOnce(): Promise<void> {
    if (polling) return;
    polling = true;
    try {
      const agent = getSessionAgent();
      const sid = getSessionId();

      // Poll DMs to this agent — skip messages FROM self (no echoes)
      if (agent) {
        const previews = (await getStore().readMessagePreviews({ to: agent, unread_only: true, order: "asc", limit: 20 })).messages
          .filter(message => message.id > lastAgentMsgId && message.from_agent !== agent);
        for (const preview of previews) {
          const msg = await getStore().getMessageById(preview.id);
          if (!msg) continue;
          const delivered = await pushNotification(msg, "dm");
          if (!delivered) break;
          lastAgentMsgId = msg.id;
        }
      }

      // Poll direct session-targeted messages — skip self (no echoes)
      if (sid) {
        const previews = (await getStore().readMessagePreviews({ to: `session:${sid}`, unread_only: true, order: "asc", limit: 20 })).messages
          .filter(message => message.id > lastSessionMsgId && message.from_agent !== agent);
        for (const preview of previews) {
          const msg = await getStore().getMessageById(preview.id);
          if (!msg) continue;
          const delivered = await pushNotification(msg, "direct");
          if (!delivered) break;
          lastSessionMsgId = msg.id;
        }
      }

      if (agent) {
        const notifications = (await getStore().readChannelNotifications({
          agent,
          unread_only: true,
          limit: 20,
          mark_read: false,
        })).sort((left, right) => left.created_at.localeCompare(right.created_at) || left.message_id - right.message_id);

        for (const notification of notifications) {
          const delivered = await pushNotification({
            id: notification.message_id,
            content: notification.preview,
            from_agent: notification.from_agent,
            session_id: `channel:${notification.channel}`,
            channel: notification.channel,
            priority: notification.priority,
          }, "channel_blurb");
          if (!delivered) break;
        }
      }
    } finally {
      polling = false;
    }
  }

  function startPolling(): void {
    if (pollTimer) return;

    pollTimer = setInterval(() => {
      void pollOnce().catch(() => { /* silently continue */ });
    }, pollIntervalMs);

    void pollOnce().catch(() => { /* silently continue */ });
  }

  // Start polling after connection established
  startTimer = setTimeout(() => startPolling(), startDelayMs);

  return () => {
    if (startTimer) clearTimeout(startTimer);
    if (pollTimer) clearInterval(pollTimer);
    startTimer = null;
    pollTimer = null;
  };
}
