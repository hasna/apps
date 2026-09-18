/**
 * Advanced tools: locks, graph, reactions, read receipts, mentions, unread counts,
 * threads, hot sessions, topics, summary, search_tools, describe_tools, send_feedback
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import { registerMcpTool } from "../tool-compat.js";
import { getStore } from "../../lib/store/index.js";
// Writes (auto-DMs) route to the cloud API when the client is flipped to it so
// a flipped fleet sees them; falls through to the local store otherwise. Read-only
// tools below still read the local store (no cloud endpoint yet) — documented residual.
import { identityFor } from "../identity.js";
import { pageQueriedItems, summarizeMessage, windowItems } from "../../lib/compact-output.js";
import { compactPreviewPage, jsonText, resolveMcpPageOptions, resolveMcpWindow } from "../compact.js";
import { MENTION_LIST_ORDER } from "../../lib/list-order.js";
import type { ConversationsToolCatalog } from "../profile.js";

export function registerAdvancedTools(server: McpServer, pkgVersion: string, toolCatalog?: ConversationsToolCatalog): void {
  // Bound to this connection: see ../identity.ts.
  const resolveIdentity = identityFor(server);

  // ---- Read Receipts ----

  registerMcpTool(server, "read_receipts", {
    description: "Get per-agent read receipts for a message. Shows who has read it and (for channel messages) who hasn't.",
    inputSchema: {
      message_id: z.coerce.number(),
      channel: z.string().optional().describe("Channel name — if provided, also returns list of members who haven't read yet"),
    },
  }, async (args: Record<string, any>) => {
    const receipts = await getStore().getReadReceipts(args.message_id);
    if (args.channel) {
      const status = await getStore().getMessageReadStatus(args.message_id, args.channel);
      return { content: [{ type: "text", text: JSON.stringify(status) }] };
    }
    return { content: [{ type: "text", text: JSON.stringify({ receipts, count: receipts.length }) }] };
  });

  registerMcpTool(server, "mark_read_receipt", {
    description: "Manually record that an agent has read a specific message.",
    inputSchema: {
      message_id: z.coerce.number(),
      agent: z.string(),
    },
  }, async (args: Record<string, any>) => {
    await getStore().recordReadReceipt(args.message_id, args.agent);
    return { content: [{ type: "text", text: `\u2713 Marked message #${args.message_id} as read by ${args.agent}` }] };
  });

  // ---- Reaction aliases + tools ----

  registerMcpTool(server, "react", {
    description: "Toggle an emoji reaction on a message (alias for add_reaction). The same actor re-adding the same emoji removes it.",
    inputSchema: { message_id: z.coerce.number(), emoji: z.string(), from: z.string().optional() },
  }, async (args: Record<string, any>) => {
    const agent = resolveIdentity(args.from);
    const result = await getStore().addReaction(args.message_id, agent, args.emoji);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  registerMcpTool(server, "unreact", {
    description: "Remove an emoji reaction (alias for remove_reaction).",
    inputSchema: { message_id: z.coerce.number(), emoji: z.string(), from: z.string().optional() },
  }, async (args: Record<string, any>) => {
    const agent = resolveIdentity(args.from);
    const removed = await getStore().removeReaction(args.message_id, agent, args.emoji);
    return { content: [{ type: "text", text: JSON.stringify({ removed }) }] };
  });

  registerMcpTool(server, "add_reaction", {
    description: "Toggle an emoji reaction on a message. The same actor re-adding the same emoji removes it; returns {toggled: \"added\"|\"removed\", reaction}.",
    inputSchema: {
      message_id: z.coerce.number(),
      emoji: z.string(),
      from: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const { message_id, emoji, from: fromParam } = args;
    const agent = resolveIdentity(fromParam);
    const result = await getStore().addReaction(message_id, agent, emoji);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  registerMcpTool(server, "remove_reaction", {
    description: "Remove an emoji reaction from a message.",
    inputSchema: {
      message_id: z.coerce.number(),
      emoji: z.string(),
      from: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const { message_id, emoji, from: fromParam } = args;
    const agent = resolveIdentity(fromParam);
    const removed = await getStore().removeReaction(message_id, agent, emoji);
    return { content: [{ type: "text", text: JSON.stringify({ removed }) }] };
  });

  registerMcpTool(server, "get_reactions", {
    description: "Get all reactions for a message.",
    inputSchema: {
      message_id: z.coerce.number(),
    },
  }, async (args: Record<string, any>) => {
    const reactions = await getStore().getReactions(args.message_id);
    return { content: [{ type: "text", text: JSON.stringify(reactions) }] };
  });

  registerMcpTool(server, "get_reaction_summary", {
    description: "Get emoji reaction counts and agent lists for a message.",
    inputSchema: {
      message_id: z.coerce.number(),
    },
  }, async (args: Record<string, any>) => {
    const summary = await getStore().getReactionSummary(args.message_id);
    return { content: [{ type: "text", text: JSON.stringify(summary) }] };
  });

  // ---- Unread Counts & Mentions ----

  registerMcpTool(server, "list_unread_counts", {
    description: "Get unread message counts per channel without fetching message content. Use this at session start to triage which channels need attention before calling read_messages.",
    inputSchema: {
      agent: z.string().optional().describe("Filter to channels the agent is a member of or has received messages in. Omit for global unread counts."),
      include_mentions: z.coerce.boolean().optional().describe("Include mention_count per channel (requires agent)"),
    },
  }, async (args: Record<string, any>) => {
    if (args.agent && args.include_mentions) {
      const counts = await getStore().listUnreadCountsWithMentions(args.agent as string);
      return { content: [{ type: "text", text: JSON.stringify(counts) }] };
    }
    const counts = await getStore().listUnreadCounts(args.agent as string | undefined);
    return { content: [{ type: "text", text: JSON.stringify(counts) }] };
  });

  registerMcpTool(server, "get_mentions", {
    description: "Get messages that @mention a specific agent. Useful for catching up on missed pings.",
    inputSchema: {
      agent: z.string().describe("Agent name to find mentions for"),
      channel: z.string().optional().describe("Filter to a specific channel"),
      unread_only: z.coerce.boolean().optional().describe("Only unread (not yet notified) mentions (default: true)"),
      limit: z.coerce.number().optional().describe("Max results (default: 50)"),
      cursor: z.coerce.number().optional().describe("Skip first N mention results"),
      verbose: z.coerce.boolean().optional().describe("Return full raw mention message records"),
    },
  }, async (args: Record<string, any>) => {
    const verbose = args.verbose === true;
    if (verbose) {
      const results = await getStore().getMessagesForAgent(args.agent as string, {
        channel: args.channel,
        unread_only: args.unread_only ?? true,
        limit: args.limit,
      });
      return { content: [{ type: "text", text: jsonText({ mentions: results, count: results.length, compact: false }) }] };
    }

    // The store's mention page already carries every bound; re-windowing it here
    // would discard skipped_count and re-derive has_more from a row count.
    const page = await getStore().readMentionPreviews(args.agent as string, {
      channel: args.channel,
      unread_only: args.unread_only ?? true,
      ...resolveMcpPageOptions(args),
    });
    const envelope = compactPreviewPage(page, MENTION_LIST_ORDER, {
      key: "mentions",
      hint: "Preview page. Acknowledge with mark_mentions_read{mention_ids:[…]} using the ids returned here.",
    });
    return { content: [{ type: "text", text: jsonText(envelope) }] };
  });

  registerMcpTool(server, "mark_mentions_read", {
    description:
      "Acknowledge @mentions by their exact mention ids, as returned by get_mentions. "
      + "There is no agent-wide or channel-wide clear: a request that names no id acknowledges nothing.",
    inputSchema: {
      agent: z.string().describe("Agent name"),
      mention_ids: z.array(z.coerce.number()).optional()
        .describe("Exact mention ids from get_mentions. An empty array is a no-op."),
    },
  }, async (args: Record<string, any>) => {
    /*
     * This tool used to take `{agent, channel?}` and clear EVERY unread mention
     * matching it. A caller that had read one mention could — and did — erase
     * the unread state of every other mention that agent had never seen, from a
     * request that named none of them. Unread state is the only record that a
     * ping went unanswered, so a broad clear destroys exactly the evidence
     * somebody would need to notice it was dropped.
     *
     * An explicitly empty list is a deliberate no-op rather than an error: a
     * caller looping over "the mentions I just handled" with nothing to hand
     * should acknowledge nothing, not fail and not acknowledge everything.
     */
    if (!Array.isArray(args.mention_ids)) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            cleared: 0,
            error: "mention_ids is required. Read get_mentions first and acknowledge the exact ids it returned.",
          }),
        }],
        isError: true,
      };
    }
    const mentionIds = (args.mention_ids as unknown[]).map(Number);
    if (mentionIds.length === 0) {
      return { content: [{ type: "text", text: JSON.stringify({ cleared: 0 }) }] };
    }
    try {
      const cleared = await getStore().markMentionsReadByIds(args.agent as string, mentionIds);
      return { content: [{ type: "text", text: JSON.stringify({ cleared }) }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : "Failed to acknowledge mentions." }],
        isError: true,
      };
    }
  });

  // ---- Graph Tools ----

  registerMcpTool(server, "build_graph", {
    description: "Build/rebuild the knowledge graph from messages, channels, and projects. Creates relationship edges between agents, channels, and projects.",
    inputSchema: {},
  }, async () => {
    const result = await getStore().buildGraph();
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  registerMcpTool(server, "get_related", {
    description: "Find all entities related to a given entity in the knowledge graph.",
    inputSchema: {
      entity_type: z.string(),
      entity_id: z.string(),
    },
  }, async (args: Record<string, any>) => {
    const related = await getStore().getRelated(args.entity_type, args.entity_id);
    return { content: [{ type: "text", text: JSON.stringify(related) }] };
  });

  registerMcpTool(server, "get_agent_network", {
    description: "Get an agent's communication network: who they talk to, channels, projects.",
    inputSchema: {
      agent: z.string(),
    },
  }, async (args: Record<string, any>) => {
    const network = await getStore().getAgentNetwork(args.agent);
    return { content: [{ type: "text", text: JSON.stringify(network) }] };
  });

  registerMcpTool(server, "graph_stats", {
    description: "Get knowledge graph statistics: total edges and counts by relation type.",
    inputSchema: {},
  }, async () => {
    const stats = await getStore().getGraphStats();
    return { content: [{ type: "text", text: JSON.stringify(stats) }] };
  });

  // ---- Summary Tools ----

  registerMcpTool(server, "get_summary", {
    description: "Get a structured summary of a conversation (session or channel): participants, topics, key messages, blockers, activity.",
    inputSchema: {
      session_id: z.string().optional(),
      channel: z.string().optional(),
      limit: z.coerce.number().optional(),
    },
  }, async (args: Record<string, any>) => {
    const target = args.channel || args.session_id;
    if (!target) return { content: [{ type: "text", text: "session_id or channel required" }], isError: true };
    const summary = await getStore().getConversationSummary(target, { limit: args.limit });
    if (!summary) return { content: [{ type: "text", text: `No messages found for "${target}"` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(summary) }] };
  });

  // ---- Topic Tools ----

  registerMcpTool(server, "get_topics", {
    description: "Extract topics from a channel or session. Returns weighted keyword list.",
    inputSchema: {
      channel: z.string().optional(),
      session_id: z.string().optional(),
      limit: z.coerce.number().optional(),
    },
  }, async (args: Record<string, any>) => {
    const topics = args.channel
      ? await getStore().getChannelTopics(args.channel, { limit: args.limit })
      : args.session_id
      ? await getStore().getSessionTopics(args.session_id, { limit: args.limit })
      : await getStore().getTrendingTopics({ top_n: args.limit });
    return { content: [{ type: "text", text: JSON.stringify(topics) }] };
  });

  registerMcpTool(server, "trending_topics", {
    description: "Get trending topics across all messages in the last N hours.",
    inputSchema: {
      hours: z.coerce.number().optional(),
      project_id: z.string().optional(),
      top_n: z.coerce.number().optional(),
    },
  }, async (args: Record<string, any>) => {
    const topics = await getStore().getTrendingTopics({ hours: args.hours, project_id: args.project_id, top_n: args.top_n });
    return { content: [{ type: "text", text: JSON.stringify(topics) }] };
  });

  // ---- Hot Conversations ----

  registerMcpTool(server, "hot_sessions", {
    description: "List conversations ranked by activity hotness (message velocity, reactions, replies, priority, blockers).",
    inputSchema: {
      limit: z.coerce.number().optional(),
      min_score: z.coerce.number().optional(),
      channel: z.string().optional(),
      project_id: z.string().optional(),
      cursor: z.coerce.number().optional(),
    },
  }, async (args: Record<string, any>) => {
    const window = resolveMcpWindow(args);
    const sessions = await getStore().listHotSessions({
      limit: window.offset + window.limit + 1,
      min_score: args.min_score,
      channel: args.channel,
      project_id: args.project_id,
    });
    const page = pageQueriedItems(sessions, window);
    return { content: [{ type: "text", text: jsonText({ sessions: page.items, count: page.count, limit: page.limit, cursor: page.cursor, next_cursor: page.next_cursor, has_more: page.has_more }) }] };
  });

  // ---- Lock Tools ----

  registerMcpTool(server, "acquire_lock", {
    description: "Acquire an advisory or exclusive lock on a resource. Returns conflict info if another agent holds the lock. On conflict, auto-DMs the holding agent.",
    inputSchema: {
      resource_type: z.string(),
      resource_id: z.string(),
      lock_type: z.enum(["advisory", "exclusive"]).optional(),
      expiry_ms: z.coerce.number().optional(),
      from: z.string().optional(),
      auto_dm: z.coerce.boolean().optional(),
    },
  }, async (args: Record<string, any>) => {
    const { resource_type, resource_id, lock_type, expiry_ms, from: fromParam, auto_dm } = args;
    const agent = resolveIdentity(fromParam);
    const result = await getStore().acquireLock(resource_type, resource_id, agent, lock_type ?? "advisory", expiry_ms);

    if (!result.acquired && result.held_by && auto_dm !== false) {
      try {
        await await getStore().sendMessage({
          from: agent,
          to: result.held_by,
          content: `Lock conflict: I (@${agent}) tried to acquire ${lock_type ?? "advisory"} lock on \`${resource_type}/${resource_id}\` but you hold it. If you no longer need it, release it with \`release_lock\`.`,
          priority: "high",
        });
      } catch {
        // DM failure must not break the lock response
      }
    }

    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  registerMcpTool(server, "release_lock", {
    description: "Release a lock held by the agent on a resource.",
    inputSchema: {
      resource_type: z.string(),
      resource_id: z.string(),
      from: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const { resource_type, resource_id, from: fromParam } = args;
    const agent = resolveIdentity(fromParam);
    const released = await getStore().releaseLock(resource_type, resource_id, agent);
    return { content: [{ type: "text", text: JSON.stringify({ released }) }] };
  });

  registerMcpTool(server, "check_lock", {
    description: "Check if a resource is currently locked and who holds it.",
    inputSchema: {
      resource_type: z.string(),
      resource_id: z.string(),
    },
  }, async (args: Record<string, any>) => {
    const lock = await getStore().checkLock(args.resource_type, args.resource_id);
    return { content: [{ type: "text", text: JSON.stringify(lock ?? { locked: false }) }] };
  });

  registerMcpTool(server, "list_locks", {
    description: "List all active (non-expired) locks enriched with agent presence details (status, online, last_seen_at) and time context (locked_seconds_ago, expires_in_seconds). Filter by resource_type or agent.",
    inputSchema: {
      resource_type: z.string().optional(),
      agent_id: z.string().optional(),
      limit: z.coerce.number().optional(),
      cursor: z.coerce.number().optional(),
    },
  }, async (args: Record<string, any>) => {
    const locks = await getStore().listLocksEnriched({ resource_type: args.resource_type, agent_id: args.agent_id });
    const window = resolveMcpWindow(args);
    const page = windowItems(locks, window);
    return { content: [{ type: "text", text: jsonText({ locks: page.items, count: page.count, total: page.total, next_cursor: page.nextCursor, has_more: page.hasMore }) }] };
  });

  registerMcpTool(server, "bulk_acquire_lock", {
    description: "Atomically acquire multiple locks at once. All-or-nothing: if any lock is held by another agent, none are acquired. Returns blocked_by info on conflict.",
    inputSchema: {
      resources: z.array(z.object({
        resource_type: z.string(),
        resource_id: z.string(),
        lock_type: z.enum(["advisory", "exclusive"]).optional(),
        expiry_ms: z.coerce.number().optional(),
      })),
      from: z.string().optional(),
      auto_dm: z.coerce.boolean().optional(),
    },
  }, async (args: Record<string, any>) => {
    const agent = resolveIdentity(args.from);
    const result = await getStore().tryBulkAcquireLock(args.resources, agent);

    if (!result.acquired && result.blocked_by && args.auto_dm !== false) {
      try {
        await await getStore().sendMessage({
          from: agent,
          to: result.blocked_by.held_by,
          content: `Bulk lock conflict: I (@${agent}) tried to atomically acquire ${args.resources.length} locks but you hold \`${result.blocked_by.resource_type}/${result.blocked_by.resource_id}\`. Release it when done.`,
          priority: "high",
        });
      } catch {
        // DM failure must not break the lock response
      }
    }

    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  registerMcpTool(server, "clean_expired_locks", {
    description: "Clean up expired locks and auto-release locks held by agents whose heartbeat has been stale for >30 minutes. Returns counts of removed locks.",
    inputSchema: {},
  }, async () => {
    const stale = await getStore().releaseStaleAgentLocks();
    const expired = await getStore().cleanExpiredLocks();
    return { content: [{ type: "text", text: JSON.stringify({ released_stale_agent: stale, released_expired: expired, total: stale + expired }) }] };
  });

  // ---- Thread Tools ----

  registerMcpTool(server, "get_thread_replies", {
    description: "Get all replies in a thread for a given parent message ID. Also accessible as read_thread.",
    inputSchema: {
      message_id: z.coerce.number(),
      limit: z.coerce.number().optional(),
      verbose: z.coerce.boolean().optional().describe("Return full raw parent/reply message records"),
    },
  }, async (args: Record<string, any>) => {
    let replies = await getStore().getThreadReplies(args.message_id);
    if (args.limit) replies = replies.slice(0, args.limit);
    const parent = await getStore().getMessageById(args.message_id);
    const payload = args.verbose
      ? { parent, replies, reply_count: replies.length, compact: false }
      : {
          parent: parent ? summarizeMessage(parent) : null,
          replies: replies.map((reply) => summarizeMessage(reply)),
          reply_count: replies.length,
          compact: true,
          hint: "Use verbose:true for full thread messages or get_message with an id.",
        };
    return { content: [{ type: "text", text: jsonText(payload) }] };
  });

  registerMcpTool(server, "read_thread", {
    description: "Alias for get_thread_replies. Read all replies to a specific message, forming a thread view.",
    inputSchema: {
      message_id: z.coerce.number(),
      limit: z.coerce.number().optional(),
      verbose: z.coerce.boolean().optional().describe("Return full raw parent/reply message records"),
    },
  }, async (args: Record<string, any>) => {
    let replies = await getStore().getThreadReplies(args.message_id);
    if (args.limit) replies = replies.slice(0, args.limit);
    const parent = await getStore().getMessageById(args.message_id);
    const payload = args.verbose
      ? { parent, replies, reply_count: replies.length, compact: false }
      : {
          parent: parent ? summarizeMessage(parent) : null,
          replies: replies.map((reply) => summarizeMessage(reply)),
          reply_count: replies.length,
          compact: true,
          hint: "Use verbose:true for full thread messages or get_message with an id.",
        };
    return { content: [{ type: "text", text: jsonText(payload) }] };
  });

  // ---- Meta Tools ----

  registerMcpTool(server, "search_tools", {
    description: "Search the complete dynamically registered MCP inventory.",
    inputSchema: {
      query: z.string().optional(),
      limit: z.coerce.number().optional(),
      cursor: z.coerce.number().optional(),
    },
  }, async (args: Record<string, any>) => {
    const matches = toolCatalog?.search(String(args.query ?? "")) ?? [];
    const limit = Math.max(1, Math.min(100, Math.trunc(Number(args.limit ?? 20))));
    const cursor = Math.max(0, Math.trunc(Number(args.cursor ?? 0)));
    const items = matches.slice(cursor, cursor + limit);
    const nextCursor = cursor + items.length < matches.length ? cursor + items.length : null;
    return { content: [{ type: "text" as const, text: JSON.stringify({
      items, count: items.length, total: matches.length, cursor, next_cursor: nextCursor,
      has_more: nextCursor !== null, complete_inventory: true,
      hint: "Restart with HASNA_CONVERSATIONS_MCP_PROFILE=full to make specialist tools callable.",
    }) }] };
  });

  registerMcpTool(server, "describe_tools", {
    description: "Describe selected tools from the complete dynamically registered inventory.",
    inputSchema: { names: z.array(z.string()).max(20) },
  }, async (args: Record<string, any>) => {
    const names = Array.isArray(args.names) ? args.names.map(String).slice(0, 20) : [];
    const described = toolCatalog?.describe(names) ?? { items: [], missing: names };
    return { content: [{ type: "text" as const, text: JSON.stringify({
      ...described, count: described.items.length, requested: names.length,
      complete: described.missing.length === 0,
      hint: "Restart with HASNA_CONVERSATIONS_MCP_PROFILE=full to make specialist tools callable.",
    }) }] };
  });

  // ---- send_feedback tool ----
  registerMcpTool(server, "send_feedback", {
    description: "Send feedback about this service",
    inputSchema: {
      message: z.string(),
      email: z.string().optional(),
      category: z.enum(["bug", "feature", "general"]).optional(),
    },
  }, async (params: Record<string, any>) => {
      try {
        const result = await getStore().saveFeedback({
          message: params.message,
          email: params.email || undefined,
          category: params.category || undefined,
        });
        if (!result.sent && result.error) {
          return { content: [{ type: "text" as const, text: result.error }], isError: true };
        }
        return { content: [{ type: "text" as const, text: "Feedback saved. Thank you!" }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: String(e) }], isError: true };
      }
    });
}
