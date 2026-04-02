/**
 * Claude Code channel bridge for conversations MCP server.
 *
 * Declares `experimental['claude/channel']` capability so Claude Code
 * (and agent-claude) can use this server as a channel for inter-session
 * messaging. When enabled, polls for new DMs to the current agent and
 * pushes them as `notifications/claude/channel` events.
 *
 * Usage: Start agent-claude with:
 *   agent-claude --channels server:conversations --dangerously-load-development-channels
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readMessages } from "../lib/messages.js";

const POLL_INTERVAL_MS = 1000;

/**
 * Register the claude/channel capability and start polling for
 * inbound messages to push as notifications.
 */
export function registerChannelBridge(server: McpServer, getAgentId: () => string | null): void {
  // Declare claude/channel capability so Claude Code registers us as a channel
  server.server.registerCapabilities({
    experimental: {
      'claude/channel': {},
    },
  });

  let lastSeenId = 0;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  // Seed lastSeenId from latest message on startup
  function seedLastSeen(agentId: string): void {
    const latest = readMessages({
      to: agentId,
      order: "desc",
      limit: 1,
    });
    if (latest.length > 0) {
      lastSeenId = latest[0].id;
    }
  }

  // Poll for new messages and push as channel notifications
  function startPolling(): void {
    if (pollTimer) return;

    const agentId = getAgentId();
    if (!agentId) return;

    seedLastSeen(agentId);

    pollTimer = setInterval(() => {
      const currentAgent = getAgentId();
      if (!currentAgent) return;

      try {
        const newMessages = readMessages({
          to: currentAgent,
          order: "asc",
          limit: 20,
        }).filter(m => m.id > lastSeenId);

        for (const msg of newMessages) {
          lastSeenId = msg.id;

          // Push as claude/channel notification
          void server.server.notification({
            method: "notifications/claude/channel",
            params: {
              content: msg.content,
              meta: {
                from: msg.from_agent,
                session_id: msg.session_id,
                ...(msg.space ? { space: msg.space } : {}),
                ...(msg.priority !== "normal" ? { priority: msg.priority } : {}),
              },
            },
          });
        }
      } catch {
        // Silently continue on poll errors
      }
    }, POLL_INTERVAL_MS);
  }

  // Start polling after a short delay to let the connection establish
  setTimeout(() => startPolling(), 500);
}
