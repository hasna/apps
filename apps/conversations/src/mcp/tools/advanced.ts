/**
 * Advanced tools: locks, graph, reactions, read receipts, mentions, unread counts,
 * threads, hot sessions, topics, summary, search_tools, describe_tools, send_feedback
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getStore } from "../../lib/store/index.js";
// Writes (auto-DMs) route to the cloud API in self_hosted mode so a flipped
// fleet sees them; falls through to the local store otherwise. Read-only tools
// below still read the local store (no cloud endpoint yet) — documented residual.
import { resolveIdentity } from "../../lib/identity.js";
import { pageQueriedItems, summarizeMessage, windowItems } from "../../lib/compact-output.js";
import { jsonText, resolveMcpWindow } from "../compact.js";

export function registerAdvancedTools(server: McpServer, pkgVersion: string): void {

  // ---- Read Receipts ----

  server.registerTool("read_receipts", {
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

  server.registerTool("mark_read_receipt", {
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

  server.registerTool("react", {
    description: "Add an emoji reaction (alias for add_reaction). Quick acknowledgment without a full reply.",
    inputSchema: { message_id: z.coerce.number(), emoji: z.string(), from: z.string().optional() },
  }, async (args: Record<string, any>) => {
    const agent = resolveIdentity(args.from);
    const reaction = await getStore().addReaction(args.message_id, agent, args.emoji);
    return { content: [{ type: "text", text: JSON.stringify(reaction) }] };
  });

  server.registerTool("unreact", {
    description: "Remove an emoji reaction (alias for remove_reaction).",
    inputSchema: { message_id: z.coerce.number(), emoji: z.string(), from: z.string().optional() },
  }, async (args: Record<string, any>) => {
    const agent = resolveIdentity(args.from);
    const removed = await getStore().removeReaction(args.message_id, agent, args.emoji);
    return { content: [{ type: "text", text: JSON.stringify({ removed }) }] };
  });

  server.registerTool("add_reaction", {
    description: "Add an emoji reaction to a message.",
    inputSchema: {
      message_id: z.coerce.number(),
      emoji: z.string(),
      from: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const { message_id, emoji, from: fromParam } = args;
    const agent = resolveIdentity(fromParam);
    const reaction = await getStore().addReaction(message_id, agent, emoji);
    return { content: [{ type: "text", text: JSON.stringify(reaction) }] };
  });

  server.registerTool("remove_reaction", {
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

  server.registerTool("get_reactions", {
    description: "Get all reactions for a message.",
    inputSchema: {
      message_id: z.coerce.number(),
    },
  }, async (args: Record<string, any>) => {
    const reactions = await getStore().getReactions(args.message_id);
    return { content: [{ type: "text", text: JSON.stringify(reactions) }] };
  });

  server.registerTool("get_reaction_summary", {
    description: "Get emoji reaction counts and agent lists for a message.",
    inputSchema: {
      message_id: z.coerce.number(),
    },
  }, async (args: Record<string, any>) => {
    const summary = await getStore().getReactionSummary(args.message_id);
    return { content: [{ type: "text", text: JSON.stringify(summary) }] };
  });

  // ---- Unread Counts & Mentions ----

  server.registerTool("list_unread_counts", {
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

  server.registerTool("get_mentions", {
    description: "Get a bounded, redacted page of messages that @mention a specific agent. Use get_message for one exact full body.",
    inputSchema: {
      agent: z.string().describe("Agent name to find mentions for"),
      channel: z.string().optional().describe("Filter to a specific channel"),
      unread_only: z.coerce.boolean().optional().describe("Only unread (not yet notified) mentions (default: true)"),
      limit: z.coerce.number().optional().describe("Max results (default: 50)"),
      cursor: z.coerce.number().optional().describe("Skip first N mention results"),
      max_bytes: z.coerce.number().optional(),
      preview_bytes: z.coerce.number().optional(),
      timeout_ms: z.coerce.number().optional(),
      verbose: z.coerce.boolean().optional().describe("Deprecated compatibility flag; collections remain preview-only"),
    },
  }, async (args: Record<string, any>) => {
    const page = await getStore().readMessagePreviews({
      mentions_only: args.agent as string,
      channel: args.channel,
      unread_only: args.unread_only ?? true,
      limit: args.limit,
      offset: args.cursor,
      order: "desc",
      max_bytes: args.max_bytes,
      preview_bytes: args.preview_bytes,
      timeout_ms: args.timeout_ms,
    });
    const { messages, ...metadata } = page;
    return {
      content: [{
        type: "text",
        text: jsonText({
          ...metadata,
          mentions: messages.map((message) => ({ mention_id: message.id, message })),
          hint: "Use get_message with an id for one exact full message.",
        }),
      }],
    };
  });

  server.registerTool("mark_mentions_read", {
    description: "Mark @mentions as seen for an agent. Clears unread mention counts.",
    inputSchema: {
      agent: z.string().describe("Agent name"),
      channel: z.string().optional().describe("Clear only mentions in this channel"),
    },
  }, async (args: Record<string, any>) => {
    const cleared = await getStore().markMentionsRead(args.agent as string, args.channel);
    return { content: [{ type: "text", text: JSON.stringify({ cleared }) }] };
  });

  // ---- Graph Tools ----

  server.registerTool("build_graph", {
    description: "Build/rebuild the knowledge graph from messages, channels, and projects. Creates relationship edges between agents, channels, and projects.",
    inputSchema: {},
  }, async () => {
    const result = await getStore().buildGraph();
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  server.registerTool("get_related", {
    description: "Find all entities related to a given entity in the knowledge graph.",
    inputSchema: {
      entity_type: z.string(),
      entity_id: z.string(),
    },
  }, async (args: Record<string, any>) => {
    const related = await getStore().getRelated(args.entity_type, args.entity_id);
    return { content: [{ type: "text", text: JSON.stringify(related) }] };
  });

  server.registerTool("get_agent_network", {
    description: "Get an agent's communication network: who they talk to, channels, projects.",
    inputSchema: {
      agent: z.string(),
    },
  }, async (args: Record<string, any>) => {
    const network = await getStore().getAgentNetwork(args.agent);
    return { content: [{ type: "text", text: JSON.stringify(network) }] };
  });

  server.registerTool("graph_stats", {
    description: "Get knowledge graph statistics: total edges and counts by relation type.",
    inputSchema: {},
  }, async () => {
    const stats = await getStore().getGraphStats();
    return { content: [{ type: "text", text: JSON.stringify(stats) }] };
  });

  // ---- Summary Tools ----

  server.registerTool("get_summary", {
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

  server.registerTool("get_topics", {
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

  server.registerTool("trending_topics", {
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

  server.registerTool("hot_sessions", {
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

  server.registerTool("acquire_lock", {
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

  server.registerTool("release_lock", {
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

  server.registerTool("check_lock", {
    description: "Check if a resource is currently locked and who holds it.",
    inputSchema: {
      resource_type: z.string(),
      resource_id: z.string(),
    },
  }, async (args: Record<string, any>) => {
    const lock = await getStore().checkLock(args.resource_type, args.resource_id);
    return { content: [{ type: "text", text: JSON.stringify(lock ?? { locked: false }) }] };
  });

  server.registerTool("list_locks", {
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

  server.registerTool("bulk_acquire_lock", {
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

  server.registerTool("clean_expired_locks", {
    description: "Clean up expired locks and auto-release locks held by agents whose heartbeat has been stale for >30 minutes. Returns counts of removed locks.",
    inputSchema: {},
  }, async () => {
    const stale = await getStore().releaseStaleAgentLocks();
    const expired = await getStore().cleanExpiredLocks();
    return { content: [{ type: "text", text: JSON.stringify({ released_stale_agent: stale, released_expired: expired, total: stale + expired }) }] };
  });

  // ---- Thread Tools ----

  server.registerTool("get_thread_replies", {
    description: "Get a bounded, redacted preview page for a thread. Also accessible as read_thread; use get_message for one exact full body.",
    inputSchema: {
      message_id: z.coerce.number(),
      limit: z.coerce.number().optional(),
      max_bytes: z.coerce.number().optional(),
      preview_bytes: z.coerce.number().optional(),
      timeout_ms: z.coerce.number().optional(),
      verbose: z.coerce.boolean().optional().describe("Deprecated compatibility flag; collections remain preview-only"),
    },
  }, async (args: Record<string, any>) => {
    const [parents, replies] = await Promise.all([
      getStore().readMessagePreviews({ id: args.message_id, limit: 1, preview_bytes: args.preview_bytes, timeout_ms: args.timeout_ms }),
      getStore().readMessagePreviews({ reply_to: args.message_id, limit: args.limit, order: "asc", max_bytes: args.max_bytes, preview_bytes: args.preview_bytes, timeout_ms: args.timeout_ms }),
    ]);
    const payload = {
      parent: parents.messages[0] ?? null,
      replies: replies.messages,
      reply_count: replies.count,
      next_cursor: replies.next_cursor,
      has_more: replies.has_more,
      compact: true,
      hint: "Use get_message with an id for one exact full message.",
    };
    return { content: [{ type: "text", text: jsonText(payload) }] };
  });

  server.registerTool("read_thread", {
    description: "Alias for get_thread_replies. Read bounded, redacted previews for one thread.",
    inputSchema: {
      message_id: z.coerce.number(),
      limit: z.coerce.number().optional(),
      max_bytes: z.coerce.number().optional(),
      preview_bytes: z.coerce.number().optional(),
      timeout_ms: z.coerce.number().optional(),
      verbose: z.coerce.boolean().optional().describe("Deprecated compatibility flag; collections remain preview-only"),
    },
  }, async (args: Record<string, any>) => {
    const [parents, replies] = await Promise.all([
      getStore().readMessagePreviews({ id: args.message_id, limit: 1, preview_bytes: args.preview_bytes, timeout_ms: args.timeout_ms }),
      getStore().readMessagePreviews({ reply_to: args.message_id, limit: args.limit, order: "asc", max_bytes: args.max_bytes, preview_bytes: args.preview_bytes, timeout_ms: args.timeout_ms }),
    ]);
    const payload = {
      parent: parents.messages[0] ?? null,
      replies: replies.messages,
      reply_count: replies.count,
      next_cursor: replies.next_cursor,
      has_more: replies.has_more,
      compact: true,
      hint: "Use get_message with an id for one exact full message.",
    };
    return { content: [{ type: "text", text: jsonText(payload) }] };
  });

  // ---- Meta Tools ----

  server.registerTool("search_tools", {
    description: "List tool names by keyword.",
    inputSchema: {
      query: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const { query } = args;
    const all = [
      "send_message", "read_messages", "get_message", "read_digest", "list_sessions", "reply",
      "mark_read", "search_messages", "export_messages",
      "create_channel", "list_channels", "send_to_channel", "read_channel",
      "join_channel", "leave_channel", "update_channel", "archive_channel", "unarchive_channel",
      "subscribe_channel_notifications", "unsubscribe_channel_notifications", "list_channel_subscriptions", "read_channel_notifications", "mark_channel_notifications_read",
      "create_project", "list_projects", "get_project", "update_project", "delete_project",
      "delete_message", "edit_message", "pin_message", "unpin_message", "get_pinned_messages",
      "build_graph", "get_related", "get_agent_network", "graph_stats",
      "get_summary",
      "get_topics", "trending_topics",
      "get_session_activity", "hot_sessions",
      "add_reaction", "remove_reaction", "get_reactions", "get_reaction_summary",
      "acquire_lock", "bulk_acquire_lock", "release_lock", "check_lock", "list_locks", "clean_expired_locks",
      "get_thread_replies",
      "set_focus", "get_focus", "unfocus",
      "register_agent", "heartbeat", "list_agents", "get_blockers", "remove_agent", "rename_agent",
      "search_tools", "describe_tools",
      // Task tools
      "create_task", "get_task", "list_tasks", "start_task", "complete_task", "cancel_task", "block_task", "unblock_task", "reopen_task", "assign_task", "set_task_priority", "delete_task",
      "add_comment", "get_comments",
      "get_subtasks", "get_task_tree",
      "add_dependency", "remove_dependency", "get_dependencies", "get_dependents",
      "get_task_activity",
    ];
    const q = query?.toLowerCase();
    const matches = q ? all.filter(n => n.includes(q)) : all;
    return { content: [{ type: "text" as const, text: matches.join(", ") }] };
  });

  server.registerTool("describe_tools", {
    description: "Get descriptions for tools by name.",
    inputSchema: {
      names: z.array(z.string()),
    },
  }, async ({ names }) => {
    const descriptions: Record<string, string> = {
      // DM tools
      send_message: "Send DM to agent. Required: to, content. Optional: from?, priority?(low|normal|high|urgent), blocking?",
      read_messages: "Read a bounded, redacted preview page with filters. Pure peek by default; mark_read:true explicitly acknowledges returned IDs. Optional: session_id?, from?, to?, channel?, since?(ISO), limit?, cursor?, unread_only?, max_bytes?, timeout_ms?",
      get_message: "Get the full content of a specific message by id. Required: id",
      read_digest: "Cursored byte-capped digest — preview snippets only, no full bodies, non-destructive unless mark_read:true. Returns { digest_id, message_ids, next_cursor, messages, byte_length }. Optional: channel?, session_id?, to?, since?(ISO), cursor?(message id), max_bytes?, limit?, unread_only?, mark_read?, project_id?",
      list_sessions: "List all DM sessions. Optional: agent?(filter by participant)",
      reply: "Reply to a specific message, creating a thread (sets reply_to). Use read_thread to retrieve. Required: message_id, content. Optional: from?",
      mark_read: "Mark messages as read. Optional: from?, ids?(array), all?(bool \u2014 mark all unread)",
      mark_channel_read: "Mark ALL messages in a channel as read without fetching. Required: channel. Optional: from?",
      search_messages: "Search messages and return bounded, redacted previews. Required: query. Optional: channel?, from?, to?, limit?, cursor?, max_bytes?, timeout_ms?",
      export_messages: "Export messages as JSON or CSV. Optional: channel?, session_id?, from?, since?, until?, format?(json|csv)",
      // Channel tools
      create_channel: "Create channel and auto-join. Required: name. Optional: from?, description?, topic?, project_id?",
      list_unread_counts: "Get unread message counts per channel (no content). Ideal for session start triage. Optional: agent?(filter to agent's channels)",
      list_channels: "List channels with member/message counts. Optional: project_id?, include_archived?",
      send_to_channel: "Post message to channel. Required: channel, content. Optional: from?, priority?(low|normal|high|urgent), blocking?",
      read_channel: "Peek at a bounded, redacted channel preview page. Pure by default; mark_read:true explicitly records receipts for returned IDs. Required: channel. Optional: since?(ISO), limit?, cursor?, max_bytes?, timeout_ms?",
      join_channel: "Join a channel. Required: channel. Optional: from?",
      leave_channel: "Leave a channel. Required: channel. Optional: from?",
      update_channel: "Update channel fields. Required: name. Optional: description?, topic?(use 'null' to remove), project_id?(use 'null' to remove)",
      archive_channel: "Archive a channel (hidden from default list). Required: name",
      unarchive_channel: "Restore archived channel. Required: name",
      subscribe_channel_notifications: "Subscribe to preview-only notifications for a channel. Required: channel. Optional: from?, preview_chars?",
      unsubscribe_channel_notifications: "Stop preview-only notifications for a channel. Required: channel. Optional: from?",
      list_channel_subscriptions: "List preview-only channel notification subscriptions for the current agent. Optional: from?, channel?",
      read_channel_notifications: "Read preview-only notifications from subscribed channels. Returns blurbs instead of full message bodies. Optional: from?, channel?, unread_only?, since?, limit?, mark_read?",
      mark_channel_notifications_read: "Mark preview-only channel notifications as read. Optional: from?, ids?(array), channel?, all?(bool)",
      // Project tools
      create_project: "Create a project. Required: name. Optional: from?, description?, path?, repository?, tags?(JSON array), metadata?(JSON), settings?(JSON)",
      list_projects: "List projects. Optional: status?(active|archived)",
      get_project: "Get project by UUID or name. Required: id",
      update_project: "Update project fields. Required: id. Optional: name?, description?, path?, status?(active|archived), repository?, tags?(JSON), metadata?(JSON), settings?(JSON)",
      delete_project: "Delete project (fails if channels reference it). Required: id",
      // Message management
      delete_message: "Delete a message (sender only). Required: id. Optional: from?",
      edit_message: "Edit message content (sender only). Required: id, content. Optional: from?",
      pin_message: "Pin a message. Required: id",
      unpin_message: "Unpin a message. Required: id",
      get_pinned_messages: "Get pinned messages. Optional: channel?, session_id?, limit?",
      // Graph
      build_graph: "Build/rebuild knowledge graph from messages, channels, projects. Returns edge counts.",
      get_related: "Find entities related to a given entity. Required: entity_type, entity_id",
      get_agent_network: "Agent's communication network: contacts, channels, projects. Required: agent",
      graph_stats: "Knowledge graph stats: total edges, by relation type",
      // Summary
      get_summary: "Structured conversation summary: participants, topics, key messages, blockers. Required: session_id? or channel?. Optional: limit?",
      // Topics
      get_topics: "Extract topics from channel or session. Optional: channel?, session_id?, limit?",
      trending_topics: "Trending topics across all messages. Optional: hours?, project_id?, top_n?",
      set_channel_topic: "Set current topic/status of a channel. Required: channel, topic (pass null to clear).",
      get_channel_topic: "Get current topic/status of a channel. Required: channel.",
      // Session activity
      get_session_activity: "Get activity metrics for a session: velocity, agents, reply ratio, reactions, trending. Required: session_id",
      // Hot conversations
      hot_sessions: "List conversations by hotness score (velocity, reactions, replies, priority, blockers). Optional: limit?, min_score?, channel?, project_id?",
      // Reaction tools
      add_reaction: "Add emoji reaction to a message. Required: message_id, emoji. Optional: from?",
      remove_reaction: "Remove emoji reaction from a message. Required: message_id, emoji. Optional: from?",
      get_reactions: "Get all reactions for a message. Required: message_id",
      get_reaction_summary: "Get emoji counts + agent lists for a message. Required: message_id",
      // Lock tools
      acquire_lock: "Acquire advisory/exclusive lock on a resource. On conflict, auto-DMs the holding agent. Required: resource_type, resource_id. Optional: lock_type?(advisory|exclusive), expiry_ms?, from?, auto_dm?(default true)",
      bulk_acquire_lock: "Atomically acquire multiple locks (all-or-nothing). Required: resources[]{resource_type,resource_id,lock_type?,expiry_ms?}. Optional: from?, auto_dm?(default true). Returns blocked_by on conflict.",
      release_lock: "Release lock held by agent. Required: resource_type, resource_id. Optional: from?",
      check_lock: "Check if resource is locked and who holds it. Required: resource_type, resource_id",
      list_locks: "List active locks enriched with agent presence + time context. Optional: resource_type?, agent_id?",
      clean_expired_locks: "Release expired locks + locks held by agents with stale heartbeat (>30 min). Returns {released_stale_agent, released_expired, total}",
      // Thread tools
      get_thread_replies: "Get all replies in a thread. Required: message_id. Optional: limit?",
      read_thread: "Alias for get_thread_replies. Required: message_id. Optional: limit?",
      // Focus mode tools
      set_focus: "Set agent focus to a project. All read tools default to this scope. Required: project_id. Optional: from?",
      get_focus: "Get current focus: session focus, DB project_id, effective project_id. Optional: from?",
      unfocus: "Clear agent focus (session + DB). Optional: from?",
      // Presence tools
      register_agent: "Register agent with conflict detection (30min active window). Required: name, session_id. Optional: role?. Returns AgentConflictError if another session is active.",
      heartbeat: "Register/refresh agent presence. Optional: from?, status?(online|busy|idle, default: online)",
      list_agents: "List agents with presence timestamps. Optional: online_only?(only agents seen in last 60s)",
      get_blockers: "Get unread blocking messages for agent. Optional: from?",
      remove_agent: "Remove agent from presence list. Optional: from?, agent?(defaults to self)",
      rename_agent: "Rename agent in presence list. Required: new_name. Optional: from?",
      // Meta tools
      search_tools: "Search tool names by keyword. Optional: query?",
      describe_tools: "Get full descriptions for tools. Required: names(array of tool names)",
      // Task tools
      create_task: "Create a new task. Required: subject, reporter. Optional: description?, assignee?, priority?(low|medium|high|critical), project_id?, channel?, parent_id?(subtask), depends_on?(array of task ids), tags?(array), metadata?(JSON), due_at?(ISO date)",
      get_task: "Get a task by id or uuid. Returns enriched TaskInfo with subtask_count, comment_count, dependency_count, blocker_info. Required: id? or uuid?",
      list_tasks: "List tasks with filters. Optional: status?(pending|in_progress|completed|cancelled|blocked), assignee?, reporter?, project_id?, channel?, parent_id?(null for top-level), priority?, tag?, limit?(default 50), offset?, include_archived?",
      start_task: "Mark task in_progress. Fails if any dependency not completed. Required: id. Optional: agent?",
      complete_task: "Mark task completed. Auto-unblocks dependent tasks with all deps met. Required: id. Optional: agent?, evidence?",
      cancel_task: "Cancel a task with optional reason. Required: id. Optional: agent?, reason?",
      block_task: "Manually block a task. Required: id. Optional: agent?, reason?",
      unblock_task: "Unblock a task to pending if all deps completed, stays blocked otherwise. Required: id. Optional: agent?",
      reopen_task: "Reopen completed/cancelled task back to pending. Re-checks dependencies. Required: id. Optional: agent?",
      assign_task: "Assign a task to an agent. Required: id, assignee. Optional: agent?",
      set_task_priority: "Change task priority. Required: id, priority(low|medium|high|critical). Optional: agent?",
      delete_task: "Delete a task. Fails if subtasks exist. Required: id. Optional: agent?",
      add_comment: "Add a comment to a task. Required: task_id, content. Optional: agent?",
      get_comments: "Get all comments on a task ordered by creation time. Required: task_id",
      get_subtasks: "Get direct children (subtasks) of a parent task. Required: parent_id",
      get_task_tree: "Get task with full subtask tree (recursive, max depth 5). Required: parent_id. Optional: max_depth?",
      add_dependency: "Add dependency: task_id depends on depends_on_id. Prevents circular deps. Auto-blocks if dep not completed. Required: task_id, depends_on_id",
      remove_dependency: "Remove a dependency. Required: task_id, depends_on_id",
      get_dependencies: "Get tasks this task depends on (must complete first). Required: task_id",
      get_dependents: "Get tasks that depend on this task (blocked by this). Required: task_id",
      get_task_activity: "Get activity log: status changes, comments, dep changes. Required: task_id. Optional: limit?(default 50)",
    };
    const result = names.map(n => `${n}: ${descriptions[n] || "See tool schema"}`).join("\n");
    return { content: [{ type: "text" as const, text: result }] };
  });

  // ---- send_feedback tool ----
  server.tool(
    "send_feedback",
    "Send feedback about this service",
    { message: z.string(), email: z.string().optional(), category: z.enum(["bug", "feature", "general"]).optional() },
    async (params) => {
      try {
        const { saveFeedback } = await import("../../lib/feedback.js");
        saveFeedback(params.message, params.email || undefined);
        return { content: [{ type: "text" as const, text: "Feedback saved. Thank you!" }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: String(e) }], isError: true };
      }
    }
  );
}
