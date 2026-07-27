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
 *   - The agent that registered/heartbeated on this MCP connection
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

type SessionState = {
  agentId: string | null;
  claudeSessionId: string | null; // agent-claude session UUID
};

/**
 * Agent identity and session, scoped to ONE MCP connection.
 *
 * This used to be two module-level globals, which is only correct for stdio,
 * where the process serves exactly one client for its whole life. The default
 * transport is Streamable HTTP — "one process per MCP, many agents" (see
 * ./index.ts) — and ./http.ts builds a fresh server per request with
 * `sessionIdGenerator: undefined`. Under module globals, the agent named by ONE
 * client's register_agent became the implicit author for EVERY client on the
 * box: the same last-writer-wins collapse that removing the agent-id write was
 * meant to end, moved from disk into memory.
 *
 * Keying on the McpServer keeps the state exactly as wide as the connection
 * that produced it. In stdio there is one server for the process, so the
 * session behaves as before. On the stateless HTTP transport the server — and
 * with it this entry — dies with the request, so nothing leaks between clients
 * and implicit attribution falls through to CONVERSATIONS_AGENT_ID and then the
 * machine identity. HTTP clients that need to be told apart must pass `from`
 * explicitly, or run their own process with CONVERSATIONS_AGENT_ID set.
 */
const sessions = new WeakMap<McpServer, SessionState>();

function sessionFor(server: McpServer): SessionState {
  let state = sessions.get(server);
  if (!state) {
    state = { agentId: null, claudeSessionId: null };
    sessions.set(server, state);
  }
  return state;
}

/**
 * Called by agent tools when register_agent or heartbeat fires.
 *
 * This records who the caller is *for this connection only*. It deliberately
 * does NOT write the installation-wide identity file ($HOME/.hasna/conversations/agent-id).
 *
 * It used to. That was a fleet-wide footgun: the MCP server runs as one
 * long-lived daemon under a single HOME, shared by every client session on the
 * machine, so a single `heartbeat` naming any agent silently re-stamped the
 * whole machine's identity — last writer wins, with no audit trail. On
 * station01 that left the box answering to a throwaway test name ("rename-old")
 * for two days, and every attempt to correct it was overwritten again.
 *
 * What is recorded here is still load-bearing: ./identity.ts resolves this
 * connection's implicit author through it, so attribution follows the agent that
 * actually registered rather than falling through to the machine identity.
 *
 * Machine identity is set deliberately, by `conversations agents register <name>
 * --identity`, the CONVERSATIONS_AGENT_ID env var, or — on a box that has no
 * identity at all — the first register_agent to claim it (see
 * ./tools/agents.ts). Never as a side effect of a heartbeat.
 */
export function setSessionAgent(server: McpServer, agentId: string, claudeSessionId?: string): void {
  const state = sessionFor(server);
  state.agentId = agentId;
  if (claudeSessionId) state.claudeSessionId = claudeSessionId;
}

/** Called by register_agent to store the claude session ID */
export function setClaudeSessionId(server: McpServer, id: string): void {
  sessionFor(server).claudeSessionId = id;
}

export function getSessionAgent(server: McpServer): string | null {
  return sessionFor(server).agentId || process.env.CONVERSATIONS_AGENT_ID || null;
}

export function getClaudeSessionId(server: McpServer): string | null {
  return sessionFor(server).claudeSessionId || process.env.CONVERSATIONS_SESSION_ID || null;
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
    return getClaudeSessionId(server);
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
        const agent = getSessionAgent(server);
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
      const agent = getSessionAgent(server);
      const sid = getSessionId();

      // Poll DMs to this agent — skip messages FROM self (no echoes)
      if (agent) {
        const msgs = (await await getStore().readMessages({ to: agent, unread_only: true, order: "asc", limit: 20 }))
          .filter(m => m.id > lastAgentMsgId && m.from_agent !== agent);
        for (const msg of msgs) {
          const delivered = await pushNotification(msg, "dm");
          if (!delivered) break;
          lastAgentMsgId = msg.id;
        }
      }

      // Poll direct session-targeted messages — skip self (no echoes)
      if (sid) {
        const msgs = (await await getStore().readMessages({ to: `session:${sid}`, unread_only: true, order: "asc", limit: 20 }))
          .filter(m => m.id > lastSessionMsgId && m.from_agent !== agent);
        for (const msg of msgs) {
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
