/**
 * Claude Code channel bridge for conversations MCP server.
 *
 * Declares `experimental['claude/channel']` capability so agent-claude
 * can use this server as a channel for inter-session messaging.
 *
 * Polls for new messages addressed to:
 *   1. The agent name (CONVERSATIONS_AGENT_ID) — standard DMs
 *   2. The session ID (session:<uuid>) — targeted session injection via send_to_session
 *
 * Messages are pushed as `notifications/claude/channel` events.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readMessages } from "../lib/messages.js";

const POLL_INTERVAL_MS = 1000;

export function registerChannelBridge(
  server: McpServer,
  getAgentId: () => string | null,
  getSessionId: () => string | null,
): void {
  server.server.registerCapabilities({
    experimental: {
      'claude/channel': {},
    },
  });

  let lastSeenId = 0;
  let lastSeenSessionId = 0;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  function seedLastSeen(agentId: string, sessionId: string | null): void {
    // Seed from agent DMs
    const latestAgent = readMessages({ to: agentId, order: "desc", limit: 1 });
    if (latestAgent.length > 0) lastSeenId = latestAgent[0].id;

    // Seed from session-targeted messages
    if (sessionId) {
      const latestSession = readMessages({ to: `session:${sessionId}`, order: "desc", limit: 1 });
      if (latestSession.length > 0) lastSeenSessionId = latestSession[0].id;
    }
  }

  function pushNotification(msg: { content: string; from_agent: string; session_id: string; space?: string | null; priority?: string }): void {
    void server.server.notification({
      method: "notifications/claude/channel",
      params: {
        content: msg.content,
        meta: {
          from: msg.from_agent,
          session_id: msg.session_id,
          ...(msg.space ? { space: msg.space } : {}),
          ...(msg.priority && msg.priority !== "normal" ? { priority: msg.priority } : {}),
        },
      },
    });
  }

  function startPolling(): void {
    if (pollTimer) return;

    const agentId = getAgentId();
    const sessionId = getSessionId();

    if (!agentId && !sessionId) return;

    if (agentId) seedLastSeen(agentId, sessionId);

    pollTimer = setInterval(() => {
      try {
        const currentAgent = getAgentId();
        const currentSession = getSessionId();

        // Poll agent DMs
        if (currentAgent) {
          const newAgentMsgs = readMessages({
            to: currentAgent,
            order: "asc",
            limit: 20,
          }).filter(m => m.id > lastSeenId);

          for (const msg of newAgentMsgs) {
            lastSeenId = msg.id;
            pushNotification(msg);
          }
        }

        // Poll session-targeted messages
        if (currentSession) {
          const newSessionMsgs = readMessages({
            to: `session:${currentSession}`,
            order: "asc",
            limit: 20,
          }).filter(m => m.id > lastSeenSessionId);

          for (const msg of newSessionMsgs) {
            lastSeenSessionId = msg.id;
            pushNotification(msg);
          }
        }
      } catch {
        // Silently continue on poll errors
      }
    }, POLL_INTERVAL_MS);
  }

  setTimeout(() => startPolling(), 500);
}
