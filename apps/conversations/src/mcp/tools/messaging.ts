/**
 * Messaging tools: send_message, read_messages, read_digest, list_sessions, reply,
 * mark_read, mark_unread, mark_space_read, search_messages, export_messages,
 * delete_message, edit_message, pin_message, unpin_message, get_pinned_messages,
 * mark_all_read, broadcast
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sendMessage, readMessages, readDigest, markRead, markReadByIds, markSpaceRead, getMessageById, searchMessages, markAllRead, exportMessages, deleteMessage, editMessage, pinMessage, unpinMessage, getPinnedMessages, markUnreadByIds } from "../../lib/messages.js";
import { listSessions } from "../../lib/sessions.js";
import { resolveIdentity } from "../../lib/identity.js";

export function registerMessagingTools(
  server: McpServer,
  resolveProjectId: (explicitProjectId: string | undefined, agentId: string) => string | undefined,
): void {

  // Per-(sender, session) rate limiter for session-targeted injections
  const _sessionInjectRate = new Map<string, { count: number; start: number }>();

  server.registerTool("send_message", {
    description: "Send a DM to an agent by name, or to a specific agent-claude session by ID. When target_session_id is provided, the message is routed to that exact session and auto-injected into its conversation.",
    inputSchema: {
      to: z.string().describe("Agent name to send to, OR use target_session_id instead for session targeting"),
      content: z.string(),
      from: z.string().optional(),
      priority: z.string().optional(),
      blocking: z.coerce.boolean().optional(),
      project_id: z.string().optional(),
      target_session_id: z.string().optional().describe("If provided, sends to a specific agent-claude session ID (UUID). The message auto-injects into that session's conversation."),
    },
  }, async (args: Record<string, any>) => {
    const { from: fromParam, to: toParam, to_agent, content, priority, blocking, project_id, target_session_id } = args;
    const to = toParam || to_agent; // Accept both "to" and "to_agent"
    const from = resolveIdentity(fromParam);

    const msg = sendMessage({
      from,
      to: target_session_id ? `session:${target_session_id}` : to,
      content,
      priority,
      blocking,
      project_id,
      metadata: target_session_id ? { target_session_id } : undefined,
    });

    return {
      content: [{ type: "text", text: JSON.stringify(msg) }],
    };
  });

  // Send a message targeted at a specific agent-claude session ID
  server.registerTool("send_to_session", {
    description: "Send a message to a specific agent-claude session by its session ID. The message will be auto-injected into that session's conversation via the channel bridge.",
    inputSchema: {
      target_session_id: z.string().describe("The agent-claude session ID (UUID) to send the message to"),
      content: z.string().describe("Message content to inject into the target session"),
      from: z.string().optional().describe("Sender agent name (defaults to CONVERSATIONS_AGENT_ID)"),
      priority: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const { target_session_id, content, from: fromParam, priority } = args;
    const from = resolveIdentity(fromParam);

    // Basic rate-limit: prevent session injection spam (allow 10 per minute per sender)
    const rateKey = `session:${from}:${target_session_id}`;
    const now = Date.now();
    const windowMs = 60_000;
    const maxPerWindow = 10;
    const rateEntry = _sessionInjectRate.get(rateKey);
    if (rateEntry && now - rateEntry.start < windowMs && rateEntry.count >= maxPerWindow) {
      return {
        content: [{ type: "text", text: `Rate limit: max ${maxPerWindow} session injections per minute. Try again soon.` }],
        isError: true,
      };
    }
    if (!rateEntry || now - rateEntry.start >= windowMs) {
      _sessionInjectRate.set(rateKey, { count: 1, start: now });
    } else {
      rateEntry.count++;
    }

    // Use session:<target_session_id> as the to field and store the real target in metadata
    const msg = sendMessage({
      from,
      to: `session:${target_session_id}`,
      content,
      priority,
      metadata: { target_session_id },
    });

    return {
      content: [{ type: "text", text: JSON.stringify(msg) }],
    };
  });

  server.registerTool("read_messages", {
    description: "Read DMs with optional filters.",
    inputSchema: {
      session_id: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      space: z.string().optional(),
      project_id: z.string().optional(),
      since: z.string().optional(),
      limit: z.coerce.number().optional(),
      unread_only: z.coerce.boolean().optional(),
      mark_read: z.coerce.boolean().optional(),
      max_content_length: z.coerce.number().optional().describe("Truncate each message content to N chars (adds truncated:true flag)"),
      threads_only: z.coerce.boolean().optional().describe("Only return root messages (reply_to IS NULL) — hides thread replies"),
      include_reply_counts: z.coerce.boolean().optional().describe("Include reply_count on each message (adds one extra query)"),
      mentions_only: z.string().optional().describe("Only return messages that @mention this agent"),
      latest: z.coerce.number().optional().describe("Return the N most recent unread messages, newest first. Shorthand for order:desc + limit:N."),
      offset: z.coerce.number().optional().describe("Skip first N messages for pagination (use with limit)"),
    },
  }, async (args: Record<string, any>) => {
    const agent = resolveIdentity(args.from);
    const messages = readMessages({
      ...args,
      project_id: args.project_id ?? resolveProjectId(undefined, agent),
    });

    if (args.mark_read !== false && messages.length > 0) {
      markReadByIds(messages.map((m) => m.id), agent);
    }

    return {
      content: [{ type: "text", text: JSON.stringify({ messages, count: messages.length, offset: args.offset ?? 0 }) }],
    };
  });

  server.registerTool("list_sessions", {
    description: "List all sessions by agent.",
    inputSchema: {
      agent: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const { agent } = args;
    const sessions = listSessions(agent);

    return {
      content: [{ type: "text", text: JSON.stringify(sessions) }],
    };
  });

  server.registerTool("reply", {
    description: "Reply to a specific message by its numeric ID, creating a thread. Use read_messages first to find the message ID.",
    inputSchema: {
      message_id: z.coerce.number().describe("Numeric message ID (integer) to reply to. Use read_messages to find IDs."),
      content: z.string(),
      from: z.string().optional(),
      reply_to: z.coerce.number().optional().describe("Alias for message_id"),
    },
  }, async (args: Record<string, any>) => {
    const { from: fromParam, message_id: mid, reply_to, content } = args;
    const message_id = mid || reply_to;
    const original = getMessageById(message_id);
    if (!original) {
      return {
        content: [{ type: "text", text: `Message #${message_id} not found` }],
        isError: true,
      };
    }

    const from = resolveIdentity(fromParam);
    const space =
      original.space ||
      (original.session_id?.startsWith("space:") ? original.session_id.slice(6) : undefined);
    const msg = sendMessage({
      from,
      to: space ?? (original.from_agent === from ? original.to_agent : original.from_agent),
      content,
      session_id: original.session_id,
      space,
      reply_to: message_id,  // thread linkage
    });

    return {
      content: [{ type: "text", text: JSON.stringify(msg) }],
    };
  });

  server.registerTool("mark_read", {
    description: "Mark messages read by IDs or all.",
    inputSchema: {
      from: z.string().optional(),
      ids: z.array(z.coerce.number()).optional(),
      all: z.coerce.boolean().optional(),
    },
  }, async (args: Record<string, any>) => {
    const { from: fromParam, ids, all } = args;
    const agent = resolveIdentity(fromParam);
    let count: number;

    if (all) {
      count = markAllRead(agent);
    } else if (ids && ids.length > 0) {
      count = markRead(ids, agent);
    } else {
      return {
        content: [{ type: "text", text: "provide ids or set all=true" }],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify({ marked_read: count }) }],
    };
  });

  server.registerTool("mark_unread", {
    description: "Re-flag a message (or messages) as unread so it re-appears in read_messages(unread_only:true). Useful for bookmarking messages to action later.",
    inputSchema: {
      message_id: z.coerce.number().optional().describe("Single message ID"),
      ids: z.array(z.coerce.number()).optional().describe("Multiple message IDs"),
    },
  }, async (args: Record<string, any>) => {
    if (!args.message_id && (!args.ids || args.ids.length === 0)) {
      return { content: [{ type: "text", text: "Provide message_id or ids" }], isError: true };
    }
    const ids: number[] = args.ids ?? (args.message_id ? [args.message_id] : []);
    const count = markUnreadByIds(ids);
    return { content: [{ type: "text", text: JSON.stringify({ marked_unread: count }) }] };
  });

  server.registerTool("mark_space_read", {
    description: "Mark ALL messages in a space as read without fetching them. Use this on busy spaces (200+ messages) where read_messages would overflow tokens.",
    inputSchema: {
      space: z.string().describe("Space name"),
      from: z.string().optional().describe("Mark read on behalf of this agent (default: current agent)"),
    },
  }, async (args: Record<string, any>) => {
    const { space, from: fromParam } = args;
    const count = markSpaceRead(space, fromParam);
    return {
      content: [{ type: "text", text: JSON.stringify({ space, marked_read: count }) }],
    };
  });

  server.registerTool("search_messages", {
    description: "Full-text search across messages. Uses FTS5 with BM25 ranking if available, falls back to LIKE. Returns messages with snippet and relevance_score.",
    inputSchema: {
      query: z.string().describe("Search query. Wrap in quotes for exact phrase: '\"BUG-005\"'"),
      space: z.string().optional().describe("Limit to a specific space"),
      from: z.string().optional().describe("Filter by sender"),
      to: z.string().optional().describe("Filter by recipient"),
      since: z.string().optional().describe("ISO 8601 date — only messages after this"),
      until: z.string().optional().describe("ISO 8601 date — only messages before this"),
      sort: z.enum(["relevance", "recent"]).optional().describe("Sort order (default: relevance)"),
      limit: z.coerce.number().optional().describe("Max results (default: 20)"),
    },
  }, async (args: Record<string, any>) => {
    const { query, space, from, to, since, until, sort, limit } = args;
    const results = searchMessages({ query, space, from, to, since, until, sort, limit });

    return {
      content: [{ type: "text", text: JSON.stringify({
        results,
        count: results.length,
        query,
      }) }],
    };
  });

  server.registerTool("export_messages", {
    description: "Export messages as JSON or CSV.",
    inputSchema: {
      space: z.string().optional(),
      session_id: z.string().optional(),
      from: z.string().optional(),
      since: z.string().optional(),
      until: z.string().optional(),
      format: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const { space, session_id, from, since, until, format } = args;
    const result = exportMessages({ space, session_id, from, since, until, format });

    return {
      content: [{ type: "text", text: result }],
    };
  });

  server.registerTool("read_digest", {
    description: "Lightweight unread message digest — returns preview-only summaries, auto-marks as read. Use instead of read_messages on busy spaces to avoid token overflow.",
    inputSchema: {
      space: z.string().optional(),
      session_id: z.string().optional(),
      to: z.string().optional(),
      since: z.string().optional(),
      limit: z.coerce.number().optional(),
      project_id: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const { space, session_id, to, since, limit, project_id } = args;
    const result = readDigest({ space, session_id, to, since, limit, project_id });
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  });

  server.registerTool("delete_message", {
    description: "Delete a message (sender only).",
    inputSchema: {
      id: z.coerce.number(),
      from: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const { from: fromParam, id } = args;
    const agent = resolveIdentity(fromParam);
    const deleted = deleteMessage(id, agent);

    if (!deleted) {
      return {
        content: [{ type: "text", text: `not found or forbidden` }],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify({ deleted: true }) }],
    };
  });

  server.registerTool("edit_message", {
    description: "Edit message content (sender only).",
    inputSchema: {
      id: z.coerce.number(),
      content: z.string(),
      from: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const { from: fromParam, id, content } = args;
    const agent = resolveIdentity(fromParam);
    const msg = editMessage(id, agent, content);

    if (!msg) {
      return {
        content: [{ type: "text", text: `not found or forbidden` }],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(msg) }],
    };
  });

  server.registerTool("pin_message", {
    description: "Pin a message.",
    inputSchema: {
      id: z.coerce.number(),
    },
  }, async ({ id }) => {
    const msg = pinMessage(id);

    if (!msg) {
      return {
        content: [{ type: "text", text: `message #${id} not found` }],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(msg) }],
    };
  });

  server.registerTool("unpin_message", {
    description: "Unpin a message.",
    inputSchema: {
      id: z.coerce.number(),
    },
  }, async ({ id }) => {
    const msg = unpinMessage(id);

    if (!msg) {
      return {
        content: [{ type: "text", text: `message #${id} not found` }],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(msg) }],
    };
  });

  server.registerTool("get_pinned_messages", {
    description: "Get pinned messages by space or session.",
    inputSchema: {
      space: z.string().optional(),
      session_id: z.string().optional(),
      limit: z.coerce.number().optional(),
    },
  }, async (args: Record<string, any>) => {
    const { space, session_id, limit } = args;
    const messages = getPinnedMessages({ space, session_id, limit });

    return {
      content: [{ type: "text", text: JSON.stringify(messages) }],
    };
  });

  server.registerTool("broadcast", {
    description: "Send the same message to multiple spaces at once. Useful for status updates, bug reports, or announcements that need to go to several spaces.",
    inputSchema: {
      spaces: z.array(z.string()).describe("List of space names to send to"),
      content: z.string().describe("Message content"),
      from: z.string().optional().describe("Sender agent name"),
      priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    },
  }, async (args: Record<string, any>) => {
    const { spaces, content, from: fromParam, priority } = args;
    const from = resolveIdentity(fromParam);
    const results: Array<{ space: string; id: number }> = [];
    const errors: string[] = [];

    for (const space of (spaces as string[])) {
      try {
        const msg = sendMessage({ from, to: space, content, space, priority });
        results.push({ space, id: msg.id });
      } catch (e) {
        errors.push(`${space}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return {
      content: [{ type: "text", text: JSON.stringify({ sent: results, errors, total: results.length }) }],
    };
  });
}
