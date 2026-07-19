/**
 * Messaging tools: send_message, read_messages, get_message, read_digest, list_sessions, reply,
 * mark_read, mark_unread, mark_channel_read, search_messages, export_messages,
 * delete_message, edit_message, pin_message, unpin_message, get_pinned_messages,
 * mark_all_read, broadcast
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getStore } from "../../lib/store/index.js";
// Reads/writes route through getStore(): ApiStore when HASNA_CONVERSATIONS_API_URL
// + _API_KEY are set (self_hosted/cloud), else LocalStore.
import { resolveIdentity } from "../../lib/identity.js";
import { compactWindowedSessions, jsonText } from "../compact.js";

export function registerMessagingTools(
  server: McpServer,
  resolveProjectId: (explicitProjectId: string | undefined, agentId: string) => Promise<string | undefined>,
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

    const msg = await await getStore().sendMessage({
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
    const msg = await await getStore().sendMessage({
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
    description: "Peek at a bounded, redacted page of message previews. This is non-mutating unless mark_read:true is explicit; use get_message for one exact full body.",
    inputSchema: {
      session_id: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      channel: z.string().optional(),
      project_id: z.string().optional(),
      since: z.string().optional(),
      limit: z.coerce.number().optional(),
      unread_only: z.coerce.boolean().optional(),
      mark_read: z.coerce.boolean().optional(),
      max_content_length: z.coerce.number().optional().describe("Deprecated compatibility alias; collection bodies are always preview-only"),
      preview_bytes: z.coerce.number().optional().describe("Maximum bytes per redacted preview (hard-capped by the server)"),
      max_bytes: z.coerce.number().optional().describe("Maximum bytes for the entire response envelope"),
      timeout_ms: z.coerce.number().optional().describe("Maximum collection-query time in milliseconds (hard-capped by the server)"),
      threads_only: z.coerce.boolean().optional().describe("Only return root messages (reply_to IS NULL) — hides thread replies"),
      include_reply_counts: z.coerce.boolean().optional().describe("Include reply_count on each message (adds one extra query)"),
      mentions_only: z.string().optional().describe("Only return messages that @mention this agent"),
      latest: z.coerce.number().optional().describe("Return the N most recent unread messages, newest first. Shorthand for order:desc + limit:N."),
      offset: z.coerce.number().optional().describe("Skip first N messages for pagination (use with limit)"),
      cursor: z.coerce.number().optional().describe("Alias for offset"),
      verbose: z.coerce.boolean().optional().describe("Deprecated compatibility flag; collection reads remain preview-only"),
    },
  }, async (args: Record<string, any>) => {
    const agent = resolveIdentity(args.from);
    const page = await getStore().readMessagePreviews({
      session_id: args.session_id,
      from: args.from,
      to: args.to,
      channel: args.channel,
      project_id: args.project_id ?? (await resolveProjectId(undefined, agent)),
      since: args.since,
      limit: args.limit,
      unread_only: args.unread_only,
      threads_only: args.threads_only,
      include_reply_counts: args.include_reply_counts,
      mentions_only: args.mentions_only,
      latest: args.latest,
      offset: args.offset ?? args.cursor,
      preview_bytes: args.preview_bytes ?? args.max_content_length,
      max_bytes: args.max_bytes,
      timeout_ms: args.timeout_ms,
    });

    if (args.mark_read === true && page.messages.length > 0) {
      await getStore().markReadByIds(page.messages.map((message) => message.id), agent);
    }

    return {
      content: [{ type: "text", text: jsonText(page) }],
    };
  });

  server.registerTool("get_message", {
    description: "Get the full content of a message by numeric ID. Use this to inspect a full channel message after receiving a preview-only notification blurb.",
    inputSchema: {
      id: z.coerce.number().describe("Numeric message ID to fetch"),
    },
  }, async (args: Record<string, any>) => {
    const message = await await getStore().getMessageById(args.id);
    if (!message) {
      return {
        content: [{ type: "text", text: `Message #${args.id} not found` }],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(message) }],
    };
  });

  server.registerTool("list_sessions", {
    description: "List all sessions by agent.",
    inputSchema: {
      agent: z.string().optional(),
      limit: z.coerce.number().optional(),
      cursor: z.coerce.number().optional(),
      verbose: z.coerce.boolean().optional().describe("Return legacy raw session array"),
    },
  }, async (args: Record<string, any>) => {
    const { agent } = args;
    const sessions = await getStore().listSessions(agent);

    return {
      content: [{ type: "text", text: jsonText(args.verbose ? sessions : compactWindowedSessions(sessions, args)) }],
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
    const original = await await getStore().getMessageById(message_id);
    if (!original) {
      return {
        content: [{ type: "text", text: `Message #${message_id} not found` }],
        isError: true,
      };
    }

    const from = resolveIdentity(fromParam);
    const channel =
      original.channel ||
      (original.session_id?.startsWith("channel:") ? original.session_id.slice(6) : undefined);
    const msg = await await getStore().sendMessage({
      from,
      to: channel ?? (original.from_agent === from ? original.to_agent : original.from_agent),
      content,
      session_id: original.session_id,
      channel,
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
      count = await await getStore().markAllRead(agent);
    } else if (ids && ids.length > 0) {
      count = await await getStore().markRead(ids, agent);
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
    const count = await await getStore().markUnreadByIds(ids);
    return { content: [{ type: "text", text: JSON.stringify({ marked_unread: count }) }] };
  });

  server.registerTool("mark_channel_read", {
    description: "Mark ALL messages in a channel as read without fetching them. Use this on busy channels (200+ messages) where read_messages would overflow tokens.",
    inputSchema: {
      channel: z.string().describe("Channel name"),
      from: z.string().optional().describe("Mark read on behalf of this agent (default: current agent)"),
    },
  }, async (args: Record<string, any>) => {
    const { channel, from: fromParam } = args;
    const count = await await getStore().markChannelRead(channel, fromParam);
    return {
      content: [{ type: "text", text: JSON.stringify({ channel, marked_read: count }) }],
    };
  });

  server.registerTool("search_messages", {
    description: "Search messages and return a bounded, redacted preview page. Full bodies never cross this collection path; use get_message for one exact result.",
    inputSchema: {
      query: z.string().describe("Search query. Wrap in quotes for exact phrase: '\"BUG-005\"'"),
      channel: z.string().optional().describe("Limit to a specific channel"),
      from: z.string().optional().describe("Filter by sender"),
      to: z.string().optional().describe("Filter by recipient"),
      since: z.string().optional().describe("ISO 8601 date — only messages after this"),
      until: z.string().optional().describe("ISO 8601 date — only messages before this"),
      sort: z.enum(["relevance", "recent"]).optional().describe("Sort order (default: relevance)"),
      limit: z.coerce.number().optional().describe("Max results (default: 20)"),
      cursor: z.coerce.number().optional().describe("Skip first N results for pagination"),
      preview_bytes: z.coerce.number().optional().describe("Maximum bytes per redacted preview (hard-capped by the server)"),
      max_bytes: z.coerce.number().optional().describe("Maximum bytes for the entire response envelope"),
      timeout_ms: z.coerce.number().optional().describe("Maximum collection-query time in milliseconds (hard-capped by the server)"),
      verbose: z.coerce.boolean().optional().describe("Deprecated compatibility flag; collection searches remain preview-only"),
    },
  }, async (args: Record<string, any>) => {
    const { query, channel, from, to, since, until, sort } = args;
    const page = await getStore().searchMessagePreviews({
      query,
      channel,
      from,
      to,
      since,
      until,
      sort,
      limit: args.limit,
      offset: args.cursor,
      preview_bytes: args.preview_bytes,
      max_bytes: args.max_bytes,
      timeout_ms: args.timeout_ms,
    });
    const { messages, ...pageMetadata } = page;

    return {
      content: [{ type: "text", text: jsonText({ ...pageMetadata, results: messages }) }],
    };
  });

  server.registerTool("export_messages", {
    description: "Export messages as JSON or CSV.",
    inputSchema: {
      channel: z.string().optional(),
      session_id: z.string().optional(),
      from: z.string().optional(),
      since: z.string().optional(),
      until: z.string().optional(),
      format: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const { channel, session_id, from, since, until, format } = args;
    const result = await getStore().exportMessages({ channel, session_id, from, since, until, format });

    return {
      content: [{ type: "text", text: result }],
    };
  });

  server.registerTool("read_digest", {
    description: "Cursored byte-capped channel digest. Returns preview-only snippets plus digest_id, message_ids, and next_cursor; use on busy channels instead of replaying read_messages.",
    inputSchema: {
      channel: z.string().optional(),
      session_id: z.string().optional(),
      to: z.string().optional(),
      since: z.string().optional(),
      cursor: z.coerce.number().optional().describe("Only include messages after this message ID"),
      max_bytes: z.coerce.number().optional().describe("Maximum JSON payload size in bytes"),
      limit: z.coerce.number().optional(),
      unread_only: z.coerce.boolean().optional().describe("Only include unread messages"),
      mark_read: z.coerce.boolean().optional().describe("Mark returned messages read after building the digest"),
      from: z.string().optional().describe("Reader identity for mark_read"),
      project_id: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const { channel, session_id, to, since, cursor, max_bytes, limit, unread_only, mark_read, from: fromParam, project_id } = args;
    const agent = resolveIdentity(fromParam);
    if (!channel && !session_id && !to) {
      return {
        content: [{ type: "text", text: "Provide channel, session_id, or to for read_digest." }],
        isError: true,
      };
    }
    let result;
    try {
      result = await await getStore().readDigest({
        channel,
        session_id,
        to,
        since,
        cursor,
        max_bytes,
        limit,
        unread_only,
        mark_read,
        reader: mark_read ? agent : undefined,
        project_id: project_id ?? (await resolveProjectId(undefined, agent)),
      });
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: jsonText(result) }],
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
    const deleted = await await getStore().deleteMessage(id, agent);

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
    const msg = await await getStore().editMessage(id, agent, content);

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
    const msg = await await getStore().pinMessage(id);

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
    const msg = await await getStore().unpinMessage(id);

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
    description: "Get a bounded, redacted page of pinned-message previews by channel or session.",
    inputSchema: {
      channel: z.string().optional(),
      session_id: z.string().optional(),
      limit: z.coerce.number().optional(),
      cursor: z.coerce.number().optional(),
      preview_bytes: z.coerce.number().optional(),
      max_bytes: z.coerce.number().optional(),
      timeout_ms: z.coerce.number().optional(),
      verbose: z.coerce.boolean().optional().describe("Deprecated compatibility flag; collections remain preview-only"),
    },
  }, async (args: Record<string, any>) => {
    const { channel, session_id } = args;
    const page = await getStore().readMessagePreviews({
      pinned_only: true,
      channel,
      session_id,
      limit: args.limit,
      offset: args.cursor,
      order: "desc",
      preview_bytes: args.preview_bytes,
      max_bytes: args.max_bytes,
      timeout_ms: args.timeout_ms,
    });

    return {
      content: [{ type: "text", text: jsonText(page) }],
    };
  });

  server.registerTool("broadcast", {
    description: "Send the same message to multiple channels at once. Useful for status updates, bug reports, or announcements that need to go to several channels.",
    inputSchema: {
      channels: z.array(z.string()).describe("List of channel names to send to"),
      content: z.string().describe("Message content"),
      from: z.string().optional().describe("Sender agent name"),
      priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    },
  }, async (args: Record<string, any>) => {
    const { channels, content, from: fromParam, priority } = args;
    const from = resolveIdentity(fromParam);
    const results: Array<{ channel: string; id: number }> = [];
    const errors: string[] = [];

    for (const channel of (channels as string[])) {
      try {
        const msg = await await getStore().sendMessage({ from, to: channel, content, channel, priority });
        results.push({ channel, id: msg.id });
      } catch (e) {
        errors.push(`${channel}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return {
      content: [{ type: "text", text: JSON.stringify({ sent: results, errors, total: results.length }) }],
    };
  });
}
