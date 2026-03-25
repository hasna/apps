#!/usr/bin/env bun
/**
 * MCP server for conversations.
 * Exposes tools for sending, reading, and managing messages, spaces, and projects between agents.
 *
 * Usage:
 *   conversations mcp          # Start MCP server on stdio
 *   conversations-mcp          # Direct binary
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerCloudTools } from "@hasna/cloud";
import { z } from "zod";
import { sendMessage, readMessages, readDigest, markRead, markReadByIds, markSpaceRead, getMessageById, searchMessages, markAllRead, exportMessages, deleteMessage, editMessage, pinMessage, unpinMessage, getPinnedMessages, getUnreadBlockers, getThreadReplies, listUnreadCounts, listUnreadCountsWithMentions, getMessagesForAgent, markMentionsRead, markUnread, markUnreadByIds, recordReadReceipt, recordReadReceiptsBatch, getReadReceipts, getMessageReadStatus } from "../lib/messages.js";
import { listSessions, getSessionActivity } from "../lib/sessions.js";
import { createSpace, updateSpace, archiveSpace, unarchiveSpace, listSpaces, getSpace, joinSpace, leaveSpace, getSpaceMembers } from "../lib/spaces.js";
import { createProject, listProjects, getProject, getProjectByName, updateProject, deleteProject } from "../lib/projects.js";
import { resolveIdentity, updateCachedAutoName } from "../lib/identity.js";
import { heartbeat, registerAgent, listAgents, removePresence, renameAgent, getPresence } from "../lib/presence.js";
import { addReaction, removeReaction, getReactions, getReactionSummary } from "../lib/reactions.js";
import { acquireLock, tryBulkAcquireLock, releaseLock, checkLock, listLocks, listLocksEnriched, cleanExpiredLocks, releaseStaleAgentLocks } from "../lib/locks.js";
import { listHotSessions } from "../lib/hot.js";
import { getSpaceTopics, getSessionTopics, getTrendingTopics } from "../lib/topics.js";
import { getConversationSummary } from "../lib/summary.js";
import { buildGraph, getRelated, getAgentNetwork, getGraphStats } from "../lib/graph.js";

import pkg from "../../package.json";

export const server = new McpServer({
  name: "conversations",
  version: pkg.version,
});

// ---- Focus Mode (session-level, in-memory) ----
// Priority: per-call param > session focus > agent_presence.project_id > no filter
const agentFocus = new Map<string, { project_id: string | null }>();

function getAgentFocus(agentId: string): string | null {
  if (agentFocus.has(agentId)) return agentFocus.get(agentId)!.project_id;
  // Fall back to DB-stored active project
  const presence = getPresence(agentId);
  return presence?.project_id ?? null;
}

function resolveProjectId(explicitProjectId: string | undefined, agentId: string): string | undefined {
  if (explicitProjectId) return explicitProjectId;
  const focused = getAgentFocus(agentId);
  return focused ?? undefined;
}

// ---- DM Tools ----

server.registerTool("send_message", {
  description: "Send a DM to an agent.",
  inputSchema: {
    to: z.string(),
    content: z.string(),
    from: z.string().optional(),
    priority: z.string().optional(),
    blocking: z.coerce.boolean().optional(),
    project_id: z.string().optional(),
  },
}, async (args: Record<string, any>) => {
  const { from: fromParam, to, content, priority, blocking, project_id } = args;
  const from = resolveIdentity(fromParam);

  const msg = sendMessage({
    from,
    to,
    content,
    priority,
    blocking,
    project_id,
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
    markReadByIds(messages.map((m) => m.id));
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
  description: "Reply to a specific message, creating a thread. Sets reply_to so it can be retrieved with get_thread_replies.",
  inputSchema: {
    message_id: z.coerce.number(),
    content: z.string(),
    from: z.string().optional(),
  },
}, async (args: Record<string, any>) => {
  const { from: fromParam, message_id, content } = args;
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
    reply_to: message_id,  // ← thread linkage
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

// ---- Space Tools ----

server.registerTool("create_space", {
  description: "Create a space and auto-join.",
  inputSchema: {
    name: z.string(),
    from: z.string().optional(),
    description: z.string().optional(),
    parent_id: z.string().optional(),
    project_id: z.string().optional(),
  },
}, async (args: Record<string, any>) => {
  const { from: fromParam, name, description, parent_id, project_id } = args;
  const agent = resolveIdentity(fromParam);
  try {
    const sp = createSpace(name, agent, { description, parent_id, project_id });
    return {
      content: [{ type: "text", text: JSON.stringify(sp) }],
    };
  } catch (e: any) {
    if (e.message?.includes("UNIQUE constraint")) {
      // Try to find the existing space to return its ID
      try {
        const existing = getSpace(name);
        if (existing) {
          return {
            content: [{ type: "text", text: `Space "${name}" already exists. Use read_space or join_space to interact with it.` }],
            isError: true,
          };
        }
      } catch { /* fallthrough */ }
      return {
        content: [{ type: "text", text: `Space "${name}" already exists. Use list_spaces to find it.` }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: e.message }],
      isError: true,
    };
  }
});

server.registerTool("list_spaces", {
  description: "List spaces with counts.",
  inputSchema: {
    project_id: z.string().optional(),
    parent_id: z.string().optional(),
    include_archived: z.coerce.boolean().optional(),
  },
}, async (args: Record<string, any>) => {
  const { project_id, parent_id, include_archived } = args;
  const opts: { project_id?: string; parent_id?: string | null; include_archived?: boolean } = {};
  if (project_id) opts.project_id = project_id;
  if (parent_id === "null") {
    opts.parent_id = null;
  } else if (parent_id) {
    opts.parent_id = parent_id;
  }
  if (include_archived) opts.include_archived = true;

  const spaces = listSpaces(opts);

  return {
    content: [{ type: "text", text: JSON.stringify(spaces) }],
  };
});

server.registerTool("read_receipts", {
  description: "Get per-agent read receipts for a message. Shows who has read it and (for space messages) who hasn't.",
  inputSchema: {
    message_id: z.coerce.number(),
    space: z.string().optional().describe("Space name — if provided, also returns list of members who haven't read yet"),
  },
}, async (args: Record<string, any>) => {
  const receipts = getReadReceipts(args.message_id);
  if (args.space) {
    const status = getMessageReadStatus(args.message_id, args.space);
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
  recordReadReceipt(args.message_id, args.agent);
  return { content: [{ type: "text", text: `✓ Marked message #${args.message_id} as read by ${args.agent}` }] };
});

// react/unreact — ergonomic aliases for add_reaction/remove_reaction
server.registerTool("react", {
  description: "Add an emoji reaction (alias for add_reaction). Quick acknowledgment without a full reply.",
  inputSchema: { message_id: z.coerce.number(), emoji: z.string(), from: z.string().optional() },
}, async (args: Record<string, any>) => {
  const agent = resolveIdentity(args.from);
  const reaction = addReaction(args.message_id, agent, args.emoji);
  return { content: [{ type: "text", text: JSON.stringify(reaction) }] };
});

server.registerTool("unreact", {
  description: "Remove an emoji reaction (alias for remove_reaction).",
  inputSchema: { message_id: z.coerce.number(), emoji: z.string(), from: z.string().optional() },
}, async (args: Record<string, any>) => {
  const agent = resolveIdentity(args.from);
  const removed = removeReaction(args.message_id, agent, args.emoji);
  return { content: [{ type: "text", text: JSON.stringify({ removed }) }] };
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

server.registerTool("list_unread_counts", {
  description: "Get unread message counts per space without fetching message content. Use this at session start to triage which spaces need attention before calling read_messages.",
  inputSchema: {
    agent: z.string().optional().describe("Filter to spaces the agent is a member of or has received messages in. Omit for global unread counts."),
    include_mentions: z.coerce.boolean().optional().describe("Include mention_count per space (requires agent)"),
  },
}, async (args: Record<string, any>) => {
  if (args.agent && args.include_mentions) {
    const counts = listUnreadCountsWithMentions(args.agent as string);
    return { content: [{ type: "text", text: JSON.stringify(counts) }] };
  }
  const counts = listUnreadCounts(args.agent as string | undefined);
  return { content: [{ type: "text", text: JSON.stringify(counts) }] };
});

server.registerTool("get_mentions", {
  description: "Get messages that @mention a specific agent. Useful for catching up on missed pings.",
  inputSchema: {
    agent: z.string().describe("Agent name to find mentions for"),
    space: z.string().optional().describe("Filter to a specific space"),
    unread_only: z.coerce.boolean().optional().describe("Only unread (not yet notified) mentions (default: true)"),
    limit: z.coerce.number().optional().describe("Max results (default: 50)"),
  },
}, async (args: Record<string, any>) => {
  const results = getMessagesForAgent(args.agent as string, {
    space: args.space,
    unread_only: args.unread_only ?? true,
    limit: args.limit,
  });
  return { content: [{ type: "text", text: JSON.stringify({ mentions: results, count: results.length }) }] };
});

server.registerTool("mark_mentions_read", {
  description: "Mark @mentions as seen for an agent. Clears unread mention counts.",
  inputSchema: {
    agent: z.string().describe("Agent name"),
    space: z.string().optional().describe("Clear only mentions in this space"),
  },
}, async (args: Record<string, any>) => {
  const cleared = markMentionsRead(args.agent as string, args.space);
  return { content: [{ type: "text", text: JSON.stringify({ cleared }) }] };
});

server.registerTool("send_to_space", {
  description: "Post a message to a space.",
  inputSchema: {
    space: z.string(),
    content: z.string(),
    from: z.string().optional(),
    priority: z.string().optional(),
    blocking: z.coerce.boolean().optional(),
  },
}, async (args: Record<string, any>) => {
  const { from: fromParam, space, content, priority, blocking } = args;
  const from = resolveIdentity(fromParam);

  const sp = getSpace(space);
  if (!sp) {
    return {
      content: [{ type: "text", text: `space "${space}" not found` }],
      isError: true,
    };
  }

  const msg = sendMessage({
    from,
    to: space,
    content,
    space,
    session_id: `space:${space}`,
    priority,
    blocking,
  });

  return {
    content: [{ type: "text", text: JSON.stringify(msg) }],
  };
});

server.registerTool("read_space", {
  description: "Read messages from a space.",
  inputSchema: {
    space: z.string(),
    from: z.string().optional().describe("Agent reading the space — used for per-agent read receipts"),
    since: z.string().optional(),
    limit: z.coerce.number().optional(),
    mark_read: z.coerce.boolean().optional(),
    max_content_length: z.coerce.number().optional().describe("Truncate each message content to N chars (adds truncated:true flag)"),
    threads_only: z.coerce.boolean().optional().describe("Only return root messages (hides thread replies)"),
    include_reply_counts: z.coerce.boolean().optional().describe("Include reply_count on each message"),
    latest: z.coerce.number().optional().describe("Return the N most recent messages, newest first"),
  },
}, async (args: Record<string, any>) => {
  const { space, from: fromParam, since, limit, mark_read, max_content_length, threads_only, include_reply_counts, latest } = args;
  const messages = readMessages({ space, since, limit, max_content_length, threads_only, include_reply_counts, latest });

  if (mark_read !== false && messages.length > 0) {
    markReadByIds(messages.map((m) => m.id));
  }

  // Record per-agent read receipts for all space messages
  if (fromParam && messages.length > 0) {
    const agent = resolveIdentity(fromParam);
    recordReadReceiptsBatch(messages.map((m) => m.id), agent);
  }

  return {
    content: [{ type: "text", text: JSON.stringify(messages) }],
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

server.registerTool("join_space", {
  description: "Join a space as a member.",
  inputSchema: {
    space: z.string(),
    from: z.string().optional(),
  },
}, async (args: Record<string, any>) => {
  const { from: fromParam, space } = args;
  const agent = resolveIdentity(fromParam);
  const ok = joinSpace(space, agent);

  if (!ok) {
    return {
      content: [{ type: "text", text: `space "${space}" not found` }],
      isError: true,
    };
  }

  return {
    content: [{ type: "text", text: JSON.stringify({ space, agent, joined: true }) }],
  };
});

server.registerTool("leave_space", {
  description: "Leave a space.",
  inputSchema: {
    space: z.string(),
    from: z.string().optional(),
  },
}, async (args: Record<string, any>) => {
  const { from: fromParam, space } = args;
  const agent = resolveIdentity(fromParam);
  const left = leaveSpace(space, agent);

  return {
    content: [{ type: "text", text: JSON.stringify({ space, agent, left }) }],
  };
});

server.registerTool("update_space", {
  description: "Update space description or parent.",
  inputSchema: {
    name: z.string(),
    description: z.string().optional(),
    parent_id: z.string().optional(),
    project_id: z.string().optional(),
  },
}, async (args: Record<string, any>) => {
  const { name, description, parent_id, project_id } = args;
  const updates: { description?: string; parent_id?: string | null; project_id?: string | null } = {};
  if (description !== undefined) updates.description = description;
  if (parent_id !== undefined) updates.parent_id = parent_id === "null" ? null : parent_id;
  if (project_id !== undefined) updates.project_id = project_id === "null" ? null : project_id;

  try {
    const sp = updateSpace(name, updates);
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

server.registerTool("archive_space", {
  description: "Archive a space.",
  inputSchema: {
    name: z.string(),
  },
}, async ({ name }) => {
  try {
    const sp = archiveSpace(name);
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

server.registerTool("unarchive_space", {
  description: "Unarchive a space.",
  inputSchema: {
    name: z.string(),
  },
}, async ({ name }) => {
  try {
    const sp = unarchiveSpace(name);
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

// ---- Project Tools ----

server.registerTool("create_project", {
  description: "Create a project for agent collaboration.",
  inputSchema: {
    name: z.string(),
    from: z.string().optional(),
    description: z.string().optional(),
    path: z.string().optional(),
    repository: z.string().optional(),
    tags: z.string().optional(),
    metadata: z.string().optional(),
    settings: z.string().optional(),
  },
}, async (args: Record<string, any>) => {
  const { from: fromParam, name, description, path, repository, tags, metadata, settings } = args;
  const agent = resolveIdentity(fromParam);

  let parsedTags: string[] | undefined;
  if (tags) {
    try {
      parsedTags = JSON.parse(tags);
    } catch {
      return {
        content: [{ type: "text", text: "invalid tags JSON (expected array)" }],
        isError: true,
      };
    }
  }

  let parsedMetadata: Record<string, unknown> | undefined;
  if (metadata) {
    try {
      parsedMetadata = JSON.parse(metadata);
    } catch {
      return {
        content: [{ type: "text", text: "invalid JSON" }],
        isError: true,
      };
    }
  }

  let parsedSettings: Record<string, unknown> | undefined;
  if (settings) {
    try {
      parsedSettings = JSON.parse(settings);
    } catch {
      return {
        content: [{ type: "text", text: "invalid JSON" }],
        isError: true,
      };
    }
  }

  try {
    const project = createProject({
      name,
      created_by: agent,
      description,
      path,
      repository,
      tags: parsedTags,
      metadata: parsedMetadata,
      settings: parsedSettings,
    });

    return {
      content: [{ type: "text", text: JSON.stringify(project) }],
    };
  } catch (e: any) {
    if (e.message?.includes("UNIQUE constraint")) {
      return {
        content: [{ type: "text", text: `project "${name}" already exists` }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: e.message }],
      isError: true,
    };
  }
});

server.registerTool("list_projects", {
  description: "List all projects.",
  inputSchema: {
    status: z.string().optional(),
  },
}, async (args: Record<string, any>) => {
  const { status } = args;
  const projects = listProjects(status ? { status } : undefined);

  return {
    content: [{ type: "text", text: JSON.stringify(projects) }],
  };
});

server.registerTool("get_project", {
  description: "Get a project by ID or name.",
  inputSchema: {
    id: z.string(),
  },
}, async ({ id }) => {
  // Try by ID first, then by name
  let project = getProject(id);
  if (!project) {
    project = getProjectByName(id);
  }

  if (!project) {
    return {
      content: [{ type: "text", text: `project "${id}" not found` }],
      isError: true,
    };
  }

  return {
    content: [{ type: "text", text: JSON.stringify(project) }],
  };
});

server.registerTool("update_project", {
  description: "Update project fields by ID.",
  inputSchema: {
    id: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    path: z.string().optional(),
    status: z.string().optional(),
    repository: z.string().optional(),
    tags: z.string().optional(),
    metadata: z.string().optional(),
    settings: z.string().optional(),
  },
}, async (args: Record<string, any>) => {
  const { id, name, description, path, status, repository, tags, metadata, settings } = args;
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (path !== undefined) updates.path = path;
  if (status !== undefined) updates.status = status;
  if (repository !== undefined) updates.repository = repository;

  if (tags) {
    try {
      updates.tags = JSON.parse(tags);
    } catch {
      return {
        content: [{ type: "text", text: "invalid tags JSON" }],
        isError: true,
      };
    }
  }
  if (metadata) {
    try {
      updates.metadata = JSON.parse(metadata);
    } catch {
      return {
        content: [{ type: "text", text: "invalid JSON" }],
        isError: true,
      };
    }
  }
  if (settings) {
    try {
      updates.settings = JSON.parse(settings);
    } catch {
      return {
        content: [{ type: "text", text: "invalid JSON" }],
        isError: true,
      };
    }
  }

  try {
    const project = updateProject(id, updates as any);
    return {
      content: [{ type: "text", text: JSON.stringify(project) }],
    };
  } catch (e: any) {
    return {
      content: [{ type: "text", text: e.message }],
      isError: true,
    };
  }
});

server.registerTool("delete_project", {
  description: "Delete a project permanently.",
  inputSchema: {
    id: z.string(),
  },
}, async ({ id }) => {
  try {
    const deleted = deleteProject(id);
    if (!deleted) {
      return {
        content: [{ type: "text", text: `project "${id}" not found` }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify({ id, deleted: true }) }],
    };
  } catch (e: any) {
    return {
      content: [{ type: "text", text: e.message }],
      isError: true,
    };
  }
});

// ---- Message Management Tools ----

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

// ---- Graph Tools ----

server.registerTool("build_graph", {
  description: "Build/rebuild the knowledge graph from messages, spaces, and projects. Creates relationship edges between agents, spaces, and projects.",
  inputSchema: {},
}, async () => {
  const result = buildGraph();
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
});

server.registerTool("get_related", {
  description: "Find all entities related to a given entity in the knowledge graph.",
  inputSchema: {
    entity_type: z.string(),
    entity_id: z.string(),
  },
}, async (args: Record<string, any>) => {
  const related = getRelated(args.entity_type, args.entity_id);
  return { content: [{ type: "text", text: JSON.stringify(related) }] };
});

server.registerTool("get_agent_network", {
  description: "Get an agent's communication network: who they talk to, spaces, projects.",
  inputSchema: {
    agent: z.string(),
  },
}, async (args: Record<string, any>) => {
  const network = getAgentNetwork(args.agent);
  return { content: [{ type: "text", text: JSON.stringify(network) }] };
});

server.registerTool("graph_stats", {
  description: "Get knowledge graph statistics: total edges and counts by relation type.",
  inputSchema: {},
}, async () => {
  const stats = getGraphStats();
  return { content: [{ type: "text", text: JSON.stringify(stats) }] };
});

// ---- Summary Tools ----

server.registerTool("get_summary", {
  description: "Get a structured summary of a conversation (session or space): participants, topics, key messages, blockers, activity.",
  inputSchema: {
    session_id: z.string().optional(),
    space: z.string().optional(),
    limit: z.coerce.number().optional(),
  },
}, async (args: Record<string, any>) => {
  const target = args.space || args.session_id;
  if (!target) return { content: [{ type: "text", text: "session_id or space required" }], isError: true };
  const summary = getConversationSummary(target, { limit: args.limit });
  if (!summary) return { content: [{ type: "text", text: `No messages found for "${target}"` }], isError: true };
  return { content: [{ type: "text", text: JSON.stringify(summary) }] };
});

// ---- Topic Tools ----

server.registerTool("get_topics", {
  description: "Extract topics from a space or session. Returns weighted keyword list.",
  inputSchema: {
    space: z.string().optional(),
    session_id: z.string().optional(),
    limit: z.coerce.number().optional(),
  },
}, async (args: Record<string, any>) => {
  const topics = args.space
    ? getSpaceTopics(args.space, { limit: args.limit })
    : args.session_id
    ? getSessionTopics(args.session_id, { limit: args.limit })
    : getTrendingTopics({ top_n: args.limit });
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
  const topics = getTrendingTopics({ hours: args.hours, project_id: args.project_id, top_n: args.top_n });
  return { content: [{ type: "text", text: JSON.stringify(topics) }] };
});

// ---- Session Activity Tools ----

server.registerTool("set_space_topic", {
  description: "Set the current topic/status of a space. Separate from the static description — use this for live status like '🔴 blocked on auth' or '✅ shipping v2'.",
  inputSchema: {
    space: z.string().describe("Space name"),
    topic: z.string().nullable().describe("New topic/status. Pass null to clear."),
  },
}, async (args: Record<string, any>) => {
  const db = (await import("../lib/db.js")).getDb();
  const existing = db.prepare("SELECT name FROM spaces WHERE name = ?").get(args.space);
  if (!existing) {
    return { content: [{ type: "text", text: `Space not found: ${args.space}` }], isError: true };
  }
  db.prepare("UPDATE spaces SET topic = ? WHERE name = ?").run(args.topic ?? null, args.space);
  return { content: [{ type: "text", text: args.topic ? `Topic set: ${args.topic}` : "Topic cleared" }] };
});

server.registerTool("get_space_topic", {
  description: "Get the current topic/status of a space.",
  inputSchema: { space: z.string() },
}, async (args: Record<string, any>) => {
  const db = (await import("../lib/db.js")).getDb();
  const row = db.prepare("SELECT topic FROM spaces WHERE name = ?").get(args.space) as { topic: string | null } | null;
  if (!row) return { content: [{ type: "text", text: `Space not found: ${args.space}` }], isError: true };
  return { content: [{ type: "text", text: JSON.stringify({ space: args.space, topic: row.topic }) }] };
});

server.registerTool("get_session_activity", {
  description: "Get activity metrics for a session: message velocity, unique agents, reply ratio, reaction count, trending status.",
  inputSchema: {
    session_id: z.string(),
  },
}, async (args: Record<string, any>) => {
  const activity = getSessionActivity(args.session_id);
  if (!activity) {
    return { content: [{ type: "text", text: `session "${args.session_id}" not found` }], isError: true };
  }
  return { content: [{ type: "text", text: JSON.stringify(activity) }] };
});

// ---- Hot Conversations Tools ----

server.registerTool("hot_sessions", {
  description: "List conversations ranked by activity hotness (message velocity, reactions, replies, priority, blockers).",
  inputSchema: {
    limit: z.coerce.number().optional(),
    min_score: z.coerce.number().optional(),
    space: z.string().optional(),
    project_id: z.string().optional(),
  },
}, async (args: Record<string, any>) => {
  const sessions = listHotSessions({
    limit: args.limit,
    min_score: args.min_score,
    space: args.space,
    project_id: args.project_id,
  });
  return { content: [{ type: "text", text: JSON.stringify(sessions) }] };
});

// ---- Reaction Tools ----

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
  const reaction = addReaction(message_id, agent, emoji);
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
  const removed = removeReaction(message_id, agent, emoji);
  return { content: [{ type: "text", text: JSON.stringify({ removed }) }] };
});

server.registerTool("get_reactions", {
  description: "Get all reactions for a message.",
  inputSchema: {
    message_id: z.coerce.number(),
  },
}, async (args: Record<string, any>) => {
  const reactions = getReactions(args.message_id);
  return { content: [{ type: "text", text: JSON.stringify(reactions) }] };
});

server.registerTool("summarize_space", {
  description: "Get a structured catch-up summary of a space for a time window — participants, topics, key messages, blockers, activity counts. No LLM required.",
  inputSchema: {
    space: z.string().describe("Space name"),
    since: z.string().optional().describe("ISO 8601 timestamp — only include messages after this. Defaults to 24h ago."),
    limit: z.coerce.number().optional().describe("Max messages to analyze (default: 100)"),
  },
}, async (args: Record<string, any>) => {
  const { space, since, limit } = args;
  const sinceTs = since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const db = (await import("../lib/db.js")).getDb();

  // Count messages in window
  const total = (db.prepare(
    "SELECT COUNT(*) as c FROM messages WHERE space = ? AND created_at >= ?"
  ).get(space, sinceTs) as { c: number }).c;

  if (total === 0) {
    return { content: [{ type: "text", text: `No messages in #${space} since ${sinceTs.slice(0, 10)}.` }] };
  }

  // Get summary using existing getConversationSummary but filtered by since
  const rows = db.prepare(
    `SELECT * FROM messages WHERE space = ? AND created_at >= ? ORDER BY created_at DESC LIMIT ?`
  ).all(space, sinceTs, limit ?? 100) as Record<string, unknown>[];

  // Participants
  const agents = new Set<string>();
  const agentCounts: Record<string, number> = {};
  const blockers: Array<{id: number; from: string; content: string; created_at: string}> = [];
  const mentions: Record<string, number> = {};

  for (const m of rows) {
    const from = m.from_agent as string;
    agents.add(from);
    agentCounts[from] = (agentCounts[from] ?? 0) + 1;
    if (m.blocking) {
      blockers.push({ id: m.id as number, from, content: (m.content as string).slice(0, 150), created_at: m.created_at as string });
    }
    // Count @mentions
    const mentionedAgents = (m.content as string).match(/@([a-zA-Z0-9_-]+)/g) ?? [];
    for (const mention of mentionedAgents) {
      const a = mention.slice(1).toLowerCase();
      mentions[a] = (mentions[a] ?? 0) + 1;
    }
  }

  const parts = [
    `Space: #${space} | Since: ${sinceTs.slice(0, 10)} | ${total} messages (showing ${rows.length})`,
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
      parts.push(`  • [${m.priority}] ${m.from_agent}: ${(m.content as string).slice(0, 100)}`);
    }
  }

  parts.push(`\nLast message: ${(rows[0]?.created_at as string)?.slice(0, 16) ?? "?"}`);

  return { content: [{ type: "text", text: parts.join("\n") }] };
});

server.registerTool("get_reaction_summary", {
  description: "Get emoji reaction counts and agent lists for a message.",
  inputSchema: {
    message_id: z.coerce.number(),
  },
}, async (args: Record<string, any>) => {
  const summary = getReactionSummary(args.message_id);
  return { content: [{ type: "text", text: JSON.stringify(summary) }] };
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
  const result = acquireLock(resource_type, resource_id, agent, lock_type ?? "advisory", expiry_ms);

  if (!result.acquired && result.held_by && auto_dm !== false) {
    try {
      sendMessage({
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
  const released = releaseLock(resource_type, resource_id, agent);
  return { content: [{ type: "text", text: JSON.stringify({ released }) }] };
});

server.registerTool("check_lock", {
  description: "Check if a resource is currently locked and who holds it.",
  inputSchema: {
    resource_type: z.string(),
    resource_id: z.string(),
  },
}, async (args: Record<string, any>) => {
  const lock = checkLock(args.resource_type, args.resource_id);
  return { content: [{ type: "text", text: JSON.stringify(lock ?? { locked: false }) }] };
});

server.registerTool("list_locks", {
  description: "List all active (non-expired) locks enriched with agent presence details (status, online, last_seen_at) and time context (locked_seconds_ago, expires_in_seconds). Filter by resource_type or agent.",
  inputSchema: {
    resource_type: z.string().optional(),
    agent_id: z.string().optional(),
  },
}, async (args: Record<string, any>) => {
  const locks = listLocksEnriched({ resource_type: args.resource_type, agent_id: args.agent_id });
  return { content: [{ type: "text", text: JSON.stringify(locks) }] };
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
  const result = tryBulkAcquireLock(args.resources, agent);

  if (!result.acquired && result.blocked_by && args.auto_dm !== false) {
    try {
      sendMessage({
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
  const stale = releaseStaleAgentLocks();
  const expired = cleanExpiredLocks();
  return { content: [{ type: "text", text: JSON.stringify({ released_stale_agent: stale, released_expired: expired, total: stale + expired }) }] };
});

// ---- Thread Tools ----

server.registerTool("get_thread_replies", {
  description: "Get all replies in a thread for a given parent message ID. Also accessible as read_thread.",
  inputSchema: {
    message_id: z.coerce.number(),
    limit: z.coerce.number().optional(),
  },
}, async (args: Record<string, any>) => {
  let replies = getThreadReplies(args.message_id);
  if (args.limit) replies = replies.slice(0, args.limit);
  const parent = getMessageById(args.message_id);
  return { content: [{ type: "text", text: JSON.stringify({ parent, replies, reply_count: replies.length }) }] };
});

server.registerTool("read_thread", {
  description: "Alias for get_thread_replies. Read all replies to a specific message, forming a thread view.",
  inputSchema: {
    message_id: z.coerce.number(),
    limit: z.coerce.number().optional(),
  },
}, async (args: Record<string, any>) => {
  let replies = getThreadReplies(args.message_id);
  if (args.limit) replies = replies.slice(0, args.limit);
  const parent = getMessageById(args.message_id);
  return { content: [{ type: "text", text: JSON.stringify({ parent, replies, reply_count: replies.length }) }] };
});

// ---- Focus Mode Tools ----

server.registerTool("set_focus", {
  description: "Set agent focus to a project. All read-heavy tools will default to this project scope. Stores in MCP session memory AND updates agent_presence.project_id in DB.",
  inputSchema: {
    project_id: z.string(),
    from: z.string().optional(),
  },
}, async (args: Record<string, any>) => {
  const { project_id, from: fromParam } = args;
  const agent = resolveIdentity(fromParam);
  agentFocus.set(agent, { project_id });

  // Also persist to DB
  const db = (await import("../lib/db.js")).getDb();
  db.prepare("UPDATE agent_presence SET project_id = ? WHERE agent = ?").run(project_id, agent);

  return {
    content: [{ type: "text", text: JSON.stringify({ agent, focused: true, project_id }) }],
  };
});

server.registerTool("get_focus", {
  description: "Get the current focus state for an agent. Returns session focus, DB project_id, and effective project_id used for filtering.",
  inputSchema: {
    from: z.string().optional(),
  },
}, async (args: Record<string, any>) => {
  const agent = resolveIdentity(args.from);
  const sessionFocus = agentFocus.get(agent) ?? null;
  const presence = getPresence(agent);
  const effective = getAgentFocus(agent);

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        agent,
        session_focus: sessionFocus?.project_id ?? null,
        db_project_id: presence?.project_id ?? null,
        effective_project_id: effective,
      }),
    }],
  };
});

server.registerTool("unfocus", {
  description: "Clear agent focus. Removes session focus and clears agent_presence.project_id in DB.",
  inputSchema: {
    from: z.string().optional(),
  },
}, async (args: Record<string, any>) => {
  const agent = resolveIdentity(args.from);
  agentFocus.delete(agent);

  // Clear from DB too
  const db = (await import("../lib/db.js")).getDb();
  db.prepare("UPDATE agent_presence SET project_id = NULL WHERE agent = ?").run(agent);

  return {
    content: [{ type: "text", text: JSON.stringify({ agent, focused: false, project_id: null }) }],
  };
});

// ---- Presence Tools ----

server.registerTool("register_agent", {
  description: "Register an agent with conflict detection. Returns AgentConflictError if another active session exists (active = heartbeat within last 30 min). Optional project_id locks agent to a project for the session.",
  inputSchema: {
    name: z.string(),
    session_id: z.string(),
    role: z.string().optional(),
    project_id: z.string().optional(),
  },
}, async (args: Record<string, any>) => {
  const { name, session_id, role, project_id } = args;
  try {
    const result = registerAgent(name, session_id, role, project_id);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  } catch (e: any) {
    if (e.message?.includes("UNIQUE constraint")) {
      return {
        content: [{ type: "text", text: `Agent "${name}" already registered. Use heartbeat to update presence, or list_agents to see active agents.` }],
        isError: true,
      };
    }
    return { content: [{ type: "text", text: e.message ?? String(e) }], isError: true };
  }
});

server.registerTool("heartbeat", {
  description: "Send presence heartbeat.",
  inputSchema: {
    from: z.string().optional(),
    status: z.string().optional(),
  },
}, async (args: Record<string, any>) => {
  const { from: fromParam, status } = args;
  const agent = resolveIdentity(fromParam);
  heartbeat(agent, status);

  return {
    content: [{ type: "text", text: JSON.stringify({ agent, status: status || "online", heartbeat: true }) }],
  };
});

server.registerTool("list_agents", {
  description: "List agents with presence status.",
  inputSchema: {
    online_only: z.coerce.boolean().optional(),
  },
}, async (args: Record<string, any>) => {
  const { online_only } = args;
  const agents = listAgents({ online_only });

  return {
    content: [{ type: "text", text: JSON.stringify(agents) }],
  };
});

server.registerTool("get_blockers", {
  description: "Check for unread blocking messages.",
  inputSchema: {
    from: z.string().optional(),
  },
}, async (args: Record<string, any>) => {
  const { from: fromParam } = args;
  const agent = resolveIdentity(fromParam);
  const blockers = getUnreadBlockers(agent);

  return {
    content: [{ type: "text", text: JSON.stringify(blockers) }],
  };
});

server.registerTool("remove_agent", {
  description: "Remove an agent from presence.",
  inputSchema: {
    from: z.string().optional(),
    agent: z.string().optional(),
  },
}, async (args: Record<string, any>) => {
  const { from: fromParam, agent: targetAgent } = args;
  const self = resolveIdentity(fromParam);
  const agent = targetAgent?.trim() || self;

  const removed = removePresence(agent);
  if (!removed) {
    return {
      content: [{ type: "text", text: `agent "${agent}" not found` }],
      isError: true,
    };
  }

  return {
    content: [{ type: "text", text: JSON.stringify({ agent, removed: true }) }],
  };
});

server.registerTool("rename_agent", {
  description: "Rename your agent in presence.",
  inputSchema: {
    new_name: z.string(),
    from: z.string().optional(),
  },
}, async (args: Record<string, any>) => {
  const { from: fromParam, new_name } = args;
  const oldName = resolveIdentity(fromParam);
  const newName = new_name.trim();

  if (!newName) {
    return {
      content: [{ type: "text", text: "new name cannot be empty" }],
      isError: true,
    };
  }

  try {
    const renamed = renameAgent(oldName, newName);
    if (!renamed) {
      return {
        content: [{ type: "text", text: `agent "${oldName}" not found` }],
        isError: true,
      };
    }

    // Update cached identity so subsequent calls resolve to the new name
    if (!fromParam) {
      updateCachedAutoName(newName);
    }

    return {
      content: [{ type: "text", text: JSON.stringify({ old_name: oldName, new_name: newName, renamed: true }) }],
    };
  } catch (e: any) {
    return {
      content: [{ type: "text", text: e.message }],
      isError: true,
    };
  }
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
    "send_message", "read_messages", "read_digest", "list_sessions", "reply",
    "mark_read", "search_messages", "export_messages",
    "create_space", "list_spaces", "send_to_space", "read_space",
    "join_space", "leave_space", "update_space", "archive_space", "unarchive_space",
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
    read_messages: "Read messages with filters. Optional: session_id?, from?, to?, space?, since?(ISO), limit?, unread_only?, mark_read?(default true — auto-marks returned messages as read, pass false to peek without consuming)",
    read_digest: "Lightweight unread digest — preview only (no full bodies), auto-marks read, never overflows tokens. Returns { messages, total_unread, shown }. Optional: space?, session_id?, to?, since?(ISO), limit?, project_id?",
    list_sessions: "List all DM sessions. Optional: agent?(filter by participant)",
    reply: "Reply to a specific message, creating a thread (sets reply_to). Use read_thread to retrieve. Required: message_id, content. Optional: from?",
    mark_read: "Mark messages as read. Optional: from?, ids?(array), all?(bool — mark all unread)",
    mark_space_read: "Mark ALL messages in a space as read without fetching. Required: space. Optional: from?",
    search_messages: "Full-text search messages. Required: query. Optional: space?, from?, to?, limit?",
    export_messages: "Export messages as JSON or CSV. Optional: space?, session_id?, from?, since?, until?, format?(json|csv)",
    // Space tools
    create_space: "Create space and auto-join. Required: name. Optional: from?, description?, parent_id?(max 3 levels), project_id?",
    list_unread_counts: "Get unread message counts per space (no content). Ideal for session start triage. Optional: agent?(filter to agent's spaces)",
    list_spaces: "List spaces with member/message counts. Optional: project_id?, parent_id?(use 'null' for top-level), include_archived?",
    send_to_space: "Post message to space. Required: space, content. Optional: from?, priority?(low|normal|high|urgent), blocking?",
    read_space: "Read messages in a space. Required: space. Optional: since?(ISO), limit?, mark_read?(default true — auto-marks returned messages as read)",
    join_space: "Join a space. Required: space. Optional: from?",
    leave_space: "Leave a space. Required: space. Optional: from?",
    update_space: "Update space fields. Required: name. Optional: description?, parent_id?(use 'null' to remove), project_id?(use 'null' to remove)",
    archive_space: "Archive a space (hidden from default list). Required: name",
    unarchive_space: "Restore archived space. Required: name",
    // Project tools
    create_project: "Create a project. Required: name. Optional: from?, description?, path?, repository?, tags?(JSON array), metadata?(JSON), settings?(JSON)",
    list_projects: "List projects. Optional: status?(active|archived)",
    get_project: "Get project by UUID or name. Required: id",
    update_project: "Update project fields. Required: id. Optional: name?, description?, path?, status?(active|archived), repository?, tags?(JSON), metadata?(JSON), settings?(JSON)",
    delete_project: "Delete project (fails if spaces reference it). Required: id",
    // Message management
    delete_message: "Delete a message (sender only). Required: id. Optional: from?",
    edit_message: "Edit message content (sender only). Required: id, content. Optional: from?",
    pin_message: "Pin a message. Required: id",
    unpin_message: "Unpin a message. Required: id",
    get_pinned_messages: "Get pinned messages. Optional: space?, session_id?, limit?",
    // Graph
    build_graph: "Build/rebuild knowledge graph from messages, spaces, projects. Returns edge counts.",
    get_related: "Find entities related to a given entity. Required: entity_type, entity_id",
    get_agent_network: "Agent's communication network: contacts, spaces, projects. Required: agent",
    graph_stats: "Knowledge graph stats: total edges, by relation type",
    // Summary
    get_summary: "Structured conversation summary: participants, topics, key messages, blockers. Required: session_id? or space?. Optional: limit?",
    // Topics
    get_topics: "Extract topics from space or session. Optional: space?, session_id?, limit?",
    trending_topics: "Trending topics across all messages. Optional: hours?, project_id?, top_n?",
    set_space_topic: "Set current topic/status of a space. Required: space, topic (pass null to clear).",
    get_space_topic: "Get current topic/status of a space. Required: space.",
    // Session activity
    get_session_activity: "Get activity metrics for a session: velocity, agents, reply ratio, reactions, trending. Required: session_id",
    // Hot conversations
    hot_sessions: "List conversations by hotness score (velocity, reactions, replies, priority, blockers). Optional: limit?, min_score?, space?, project_id?",
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
      const db = (await import("../lib/db.js")).getDb();
      db.prepare("INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)").run(params.message, params.email || null, params.category || "general", pkg.version);
      return { content: [{ type: "text" as const, text: "Feedback saved. Thank you!" }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: String(e) }], isError: true };
    }
  }
);

// ---- Start server ----

export async function startMcpServer() {
  const transport = new StdioServerTransport();
  registerCloudTools(server, "conversations");
  await server.connect(transport);
}

// If run directly (not imported)
const isDirectRun = import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("mcp.js") ||
  process.argv[1]?.endsWith("mcp.ts");

if (isDirectRun) {
  startMcpServer().catch((error) => {
    console.error("MCP server error:", error);
    process.exit(1);
  });
}
