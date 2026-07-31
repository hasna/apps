/**
 * Channel tools: create_channel, list_channels, send_to_channel, read_channel,
 * join_channel, leave_channel, update_channel, archive_channel, unarchive_channel,
 * subscribe_channel_notifications, unsubscribe_channel_notifications,
 * list_channel_subscriptions, read_channel_notifications, mark_channel_notifications_read,
 * set_channel_topic, get_channel_topic, summarize_channel
 *
 * Every read/write routes through the Store (getStore()): LocalStore on-box, or
 * ApiStore against the self_hosted/cloud API. Nothing here touches sqlite directly.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import { registerMcpTool } from "../tool-compat.js";
import { sendResult } from "../redaction-result.js";
import { getStore } from "../../lib/store/index.js";
import { identityFor } from "../identity.js";
import { assertNoSensitiveContent, redactSensitiveText } from "../../lib/content-safety.js";
import { compactQueriedMessages, compactWindowedChannels, jsonText, resolveMcpWindow } from "../compact.js";
import { resolveReadWindow, takeWindow } from "../../lib/message-window.js";
import { describeReadMessagesOrder } from "../../lib/list-order.js";

function toolError(error: unknown, fallback: string) {
  return {
    content: [{ type: "text" as const, text: error instanceof Error ? error.message : fallback }],
    isError: true,
  };
}

export function registerChannelTools(server: McpServer): void {
  // Bound to this connection: see ../identity.ts.
  const resolveIdentity = identityFor(server);

  registerMcpTool(server, "create_channel", {
    description: "Create a channel and auto-join.",
    inputSchema: {
      name: z.string(),
      from: z.string().optional(),
      description: z.string().optional(),
      topic: z.string().optional(),
      project_id: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const store = getStore();
    const { from: fromParam, name, description, topic, project_id } = args;
    const agent = resolveIdentity(fromParam);
    try {
      const sp = await store.createChannel(name, agent, { description, topic, project_id });
      return {
        content: [{ type: "text", text: JSON.stringify(sp) }],
      };
    } catch (e: any) {
      if (e.message?.includes("UNIQUE constraint")) {
        try {
          const existing = await store.getChannel(name);
          if (existing) {
            return {
              content: [{ type: "text", text: `Channel "${name}" already exists. Use read_channel or join_channel to interact with it.` }],
              isError: true,
            };
          }
        } catch { /* fallthrough */ }
        return {
          content: [{ type: "text", text: `Channel "${name}" already exists. Use list_channels to find it.` }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: e.message }],
        isError: true,
      };
    }
  });

  registerMcpTool(server, "list_channels", {
    description: "List channels with counts.",
    inputSchema: {
      project_id: z.string().optional(),
      include_archived: z.coerce.boolean().optional(),
      limit: z.coerce.number().optional(),
      cursor: z.coerce.number().optional(),
      verbose: z.coerce.boolean().optional().describe("Return legacy raw channel array"),
    },
  }, async (args: Record<string, any>) => {
    const store = getStore();
    const { project_id, include_archived } = args;
    const opts: { project_id?: string; include_archived?: boolean } = {};
    if (project_id) opts.project_id = project_id;
    if (include_archived) opts.include_archived = true;

    const channels = await store.listChannels(opts);

    return {
      content: [{ type: "text", text: jsonText(args.verbose ? channels : compactWindowedChannels(channels, args)) }],
    };
  });

  registerMcpTool(server, "send_to_channel", {
    description: "Post a message to a channel.",
    inputSchema: {
      channel: z.string(),
      content: z.string(),
      from: z.string().optional(),
      priority: z.string().optional(),
      blocking: z.coerce.boolean().optional(),
    },
  }, async (args: Record<string, any>) => {
    const store = getStore();
    const { from: fromParam, channel, content, priority, blocking } = args;
    const from = resolveIdentity(fromParam);

    try {
      assertNoSensitiveContent(channel, "Message channel");
    } catch (error) {
      return toolError(error, "Failed to send channel message.");
    }

    const sp = await store.getChannel(channel);
    if (!sp) {
      return {
        content: [{ type: "text", text: "channel not found" }],
        isError: true,
      };
    }

    let msg;
    try {
      msg = await store.sendMessage({
        from,
        to: channel,
        content,
        channel,
        session_id: `channel:${channel}`,
        priority,
        blocking,
      });
    } catch (error) {
      return toolError(error, "Failed to send channel message.");
    }

    return sendResult(content, msg);
  });

  registerMcpTool(server, "read_channel", {
    description: "Read messages from a channel.",
    inputSchema: {
      channel: z.string(),
      from: z.string().optional().describe("Agent reading the channel — used for per-agent read receipts"),
      since: z.string().optional(),
      limit: z.coerce.number().optional(),
      mark_read: z.coerce.boolean().optional(),
      max_content_length: z.coerce.number().optional().describe("Truncate each message content to N chars (adds truncated:true flag)"),
      threads_only: z.coerce.boolean().optional().describe("Only return root messages (hides thread replies)"),
      include_reply_counts: z.coerce.boolean().optional().describe("Include reply_count on each message"),
      latest: z.coerce.number().optional().describe("Return the N most recent messages, newest first"),
      cursor: z.coerce.number().optional().describe("Alias for offset pagination"),
      verbose: z.coerce.boolean().optional().describe("Return full raw message records instead of compact previews"),
    },
  }, async (args: Record<string, any>) => {
    const store = getStore();
    const { channel, from: fromParam, since, limit, mark_read, max_content_length, threads_only, include_reply_counts, latest } = args;
    const window = resolveMcpWindow(args);
    const verbose = args.verbose === true;
    const query = {
      channel,
      since,
      limit: verbose ? limit : window.limit + 1,
      offset: verbose ? args.cursor : window.offset,
      max_content_length: verbose ? max_content_length : undefined,
      threads_only,
      include_reply_counts,
      latest,
    };
    const messages = await store.readMessages(query);
    // A recency window arrives newest-anchored but chronological, so the page is
    // the tail of the over-fetched rows (todos 2c25973b).
    const newestWindow = resolveReadWindow(query).newestWindow;
    const visible = verbose ? messages : takeWindow(messages, window.limit, newestWindow);

    if (mark_read !== false && visible.length > 0) {
      await store.markReadByIds(visible.map((m) => m.id));
    }

    // Record per-agent read receipts for all channel messages
    if (fromParam && visible.length > 0) {
      const agent = resolveIdentity(fromParam);
      await store.recordReadReceiptsBatch(visible.map((m) => m.id), agent);
      await store.markChannelNotificationsRead(agent, visible.map((m) => m.id));
    }

    return {
      content: [{ type: "text", text: jsonText(verbose ? messages : compactQueriedMessages(messages, args, describeReadMessagesOrder(args), { newestWindow })) }],
    };
  });

  registerMcpTool(server, "join_channel", {
    description: "Join a channel as a member.",
    inputSchema: {
      channel: z.string(),
      from: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const store = getStore();
    const { from: fromParam, channel } = args;
    const agent = resolveIdentity(fromParam);
    const ok = await store.joinChannel(channel, agent);

    if (!ok) {
      return {
        content: [{ type: "text", text: `channel "${channel}" not found` }],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify({ channel, agent, joined: true }) }],
    };
  });

  registerMcpTool(server, "leave_channel", {
    description: "Leave a channel.",
    inputSchema: {
      channel: z.string(),
      from: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const store = getStore();
    const { from: fromParam, channel } = args;
    const agent = resolveIdentity(fromParam);
    const left = await store.leaveChannel(channel, agent);

    return {
      content: [{ type: "text", text: JSON.stringify({ channel, agent, left }) }],
    };
  });

  registerMcpTool(server, "subscribe_channel_notifications", {
    description: "Subscribe an agent to preview-only notifications for a channel.",
    inputSchema: {
      channel: z.string(),
      from: z.string().optional(),
      preview_chars: z.coerce.number().optional(),
    },
  }, async (args: Record<string, any>) => {
    const store = getStore();
    const agent = resolveIdentity(args.from);
    try {
      const subscription = await store.subscribeToChannelNotifications(args.channel, agent, { preview_chars: args.preview_chars });
      return { content: [{ type: "text", text: JSON.stringify(subscription) }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: e.message }], isError: true };
    }
  });

  registerMcpTool(server, "unsubscribe_channel_notifications", {
    description: "Stop preview-only notifications for a channel.",
    inputSchema: {
      channel: z.string(),
      from: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const store = getStore();
    const agent = resolveIdentity(args.from);
    const unsubscribed = await store.unsubscribeFromChannelNotifications(args.channel, agent);
    return { content: [{ type: "text", text: JSON.stringify({ channel: args.channel, agent, unsubscribed }) }] };
  });

  registerMcpTool(server, "list_channel_subscriptions", {
    description: "List an agent's preview-only channel notification subscriptions.",
    inputSchema: {
      from: z.string().optional(),
      channel: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const store = getStore();
    const agent = resolveIdentity(args.from);
    const subscriptions = (await store.listChannelNotificationSubscriptions(agent))
      .filter((row) => !args.channel || row.channel === args.channel);
    return { content: [{ type: "text", text: JSON.stringify(subscriptions) }] };
  });

  registerMcpTool(server, "read_channel_notifications", {
    description: "Read preview-only notifications for an agent's subscribed channels. Returns blurbs, not full message bodies.",
    inputSchema: {
      from: z.string().optional(),
      channel: z.string().optional(),
      unread_only: z.coerce.boolean().optional(),
      limit: z.coerce.number().optional(),
      since: z.string().optional(),
      mark_read: z.coerce.boolean().optional(),
    },
  }, async (args: Record<string, any>) => {
    const store = getStore();
    const agent = resolveIdentity(args.from);
    const notifications = await store.readChannelNotifications({
      agent,
      channel: args.channel,
      unread_only: args.unread_only,
      limit: args.limit,
      since: args.since,
      mark_read: args.mark_read,
    });
    return { content: [{ type: "text", text: JSON.stringify({ notifications, count: notifications.length }) }] };
  });

  registerMcpTool(server, "mark_channel_notifications_read", {
    description: "Mark preview-only channel notifications as read for an agent.",
    inputSchema: {
      from: z.string().optional(),
      ids: z.array(z.coerce.number()).optional(),
      channel: z.string().optional(),
      all: z.coerce.boolean().optional(),
    },
  }, async (args: Record<string, any>) => {
    const store = getStore();
    const agent = resolveIdentity(args.from);
    let marked = 0;
    if (args.all) {
      marked = await store.markAllChannelNotificationsRead(agent, args.channel);
    } else if (Array.isArray(args.ids) && args.ids.length > 0) {
      marked = await store.markChannelNotificationsRead(agent, args.ids);
    } else {
      return { content: [{ type: "text", text: "Provide ids or all=true" }], isError: true };
    }

    return { content: [{ type: "text", text: JSON.stringify({ marked_read: marked }) }] };
  });

  registerMcpTool(server, "update_channel", {
    description: "Update channel name (rename), description, topic, or project. Pass new_name to rename while preserving messages, members, and history.",
    inputSchema: {
      name: z.string(),
      new_name: z.string().optional().describe("Rename the channel to this name (preserves messages/members/history)"),
      description: z.string().optional(),
      topic: z.string().optional(),
      project_id: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const store = getStore();
    const { name, new_name, description, topic, project_id } = args;
    const updates: { name?: string; description?: string; topic?: string | null; project_id?: string | null } = {};
    if (new_name !== undefined) updates.name = new_name;
    if (description !== undefined) updates.description = description;
    if (topic !== undefined) updates.topic = topic === "null" ? null : topic;
    if (project_id !== undefined) updates.project_id = project_id === "null" ? null : project_id;

    try {
      const sp = await store.updateChannel(name, updates);
      return {
        content: [{ type: "text", text: JSON.stringify(sp) }],
      };
    } catch (e: any) {
      return {
        content: [{ type: "text", text: e.message }],
        isError: true,
      };
    }
  });

  registerMcpTool(server, "rename_channel", {
    description: "Rename a channel, preserving its messages, members, subscriptions, and history.",
    inputSchema: {
      name: z.string().describe("Current channel name"),
      new_name: z.string().describe("New channel name"),
    },
  }, async (args: Record<string, any>) => {
    const store = getStore();
    try {
      const sp = await store.renameChannel(args.name, args.new_name);
      return {
        content: [{ type: "text", text: JSON.stringify(sp) }],
      };
    } catch (e: any) {
      return {
        content: [{ type: "text", text: e.message }],
        isError: true,
      };
    }
  });

  registerMcpTool(server, "archive_channel", {
    description: "Archive a channel.",
    inputSchema: {
      name: z.string(),
    },
  }, async ({ name }) => {
    const store = getStore();
    try {
      const sp = await store.archiveChannel(name);
      return {
        content: [{ type: "text", text: JSON.stringify(sp) }],
      };
    } catch (e: any) {
      return {
        content: [{ type: "text", text: e.message }],
        isError: true,
      };
    }
  });

  registerMcpTool(server, "unarchive_channel", {
    description: "Unarchive a channel.",
    inputSchema: {
      name: z.string(),
    },
  }, async ({ name }) => {
    const store = getStore();
    try {
      const sp = await store.unarchiveChannel(name);
      return {
        content: [{ type: "text", text: JSON.stringify(sp) }],
      };
    } catch (e: any) {
      return {
        content: [{ type: "text", text: e.message }],
        isError: true,
      };
    }
  });

  registerMcpTool(server, "set_channel_topic", {
    description: "Set the current topic/status of a channel. Separate from the static description — use this for live status like '🔴 blocked on auth' or '✅ shipping v2'.",
    inputSchema: {
      channel: z.string().describe("Channel name"),
      topic: z.string().nullable().describe("New topic/status. Pass null to clear."),
    },
  }, async (args: Record<string, any>) => {
    const store = getStore();
    const existing = await store.getChannel(args.channel);
    if (!existing) {
      return { content: [{ type: "text", text: `Channel not found: ${args.channel}` }], isError: true };
    }
    await store.updateChannel(args.channel, { topic: args.topic ?? null });
    return { content: [{ type: "text", text: args.topic ? `Topic set: ${args.topic}` : "Topic cleared" }] };
  });

  registerMcpTool(server, "get_channel_topic", {
    description: "Get the current topic/status of a channel.",
    inputSchema: { channel: z.string() },
  }, async (args: Record<string, any>) => {
    const store = getStore();
    const row = await store.getChannel(args.channel);
    if (!row) return { content: [{ type: "text", text: `Channel not found: ${args.channel}` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify({ channel: args.channel, topic: row.topic }) }] };
  });

  registerMcpTool(server, "summarize_channel", {
    description: "Get a structured catch-up summary of a channel for a time window — participants, topics, key messages, blockers, activity counts. No LLM required.",
    inputSchema: {
      channel: z.string().describe("Channel name"),
      since: z.string().optional().describe("ISO 8601 timestamp — only include messages after this. Defaults to 24h ago."),
      limit: z.coerce.number().optional().describe("Max messages to analyze (default: 100)"),
    },
  }, async (args: Record<string, any>) => {
    const store = getStore();
    const { channel, since, limit } = args;
    const sinceTs = since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Newest-first window through the Store (no direct sqlite).
    const rows = await store.readMessages({ channel, since: sinceTs, latest: limit ?? 100 });
    const total = rows.length;

    if (total === 0) {
      return { content: [{ type: "text", text: `No messages in #${channel} since ${sinceTs.slice(0, 10)}.` }] };
    }

    // Participants
    const agents = new Set<string>();
    const agentCounts: Record<string, number> = {};
    const blockers: Array<{ id: number; from: string; content: string; created_at: string }> = [];
    const mentions: Record<string, number> = {};

    for (const m of rows) {
      const from = m.from_agent;
      const content = redactSensitiveText(m.content);
      agents.add(from);
      agentCounts[from] = (agentCounts[from] ?? 0) + 1;
      if (m.blocking) {
        blockers.push({ id: m.id, from, content: content.slice(0, 150), created_at: m.created_at });
      }
      // Count @mentions
      const mentionedAgents = content.match(/@([a-zA-Z0-9_-]+)/g) ?? [];
      for (const mention of mentionedAgents) {
        const a = mention.slice(1).toLowerCase();
        mentions[a] = (mentions[a] ?? 0) + 1;
      }
    }

    const parts = [
      `Channel: #${channel} | Since: ${sinceTs.slice(0, 10)} | ${total} messages (showing ${rows.length})`,
      `\nParticipants (${agents.size}): ${Object.entries(agentCounts).sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n}(${c})`).join(", ")}`,
    ];

    if (Object.keys(mentions).length > 0) {
      const topMentions = Object.entries(mentions).sort((a, b) => b[1] - a[1]).slice(0, 5);
      parts.push(`Most mentioned: ${topMentions.map(([n, c]) => `@${n}(${c})`).join(", ")}`);
    }

    if (blockers.length > 0) {
      parts.push(`\n⛔ ${blockers.length} blocking message(s):`);
      for (const b of blockers.slice(0, 5)) {
        parts.push(`  • [#${b.id}] ${b.from}: ${b.content}${b.content.length > 150 ? "..." : ""}`);
      }
    }

    // Recent key messages (high priority or replies)
    const highPri = rows.filter((m) => m.priority === "high" || m.priority === "urgent").slice(0, 5);
    if (highPri.length > 0) {
      parts.push(`\n🔴 High priority (${highPri.length}):`);
      for (const m of highPri) {
        parts.push(`  • [${m.priority}] ${m.from_agent}: ${redactSensitiveText(m.content).slice(0, 100)}`);
      }
    }

    parts.push(`\nLast message: ${rows[0]?.created_at?.slice(0, 16) ?? "?"}`);

    return { content: [{ type: "text", text: parts.join("\n") }] };
  });
}
