/**
 * Space tools: create_space, list_spaces, send_to_space, read_space,
 * join_space, leave_space, update_space, archive_space, unarchive_space,
 * set_space_topic, get_space_topic, summarize_space
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sendMessage, readMessages, markReadByIds } from "../../lib/messages.js";
import { createSpace, updateSpace, archiveSpace, unarchiveSpace, listSpaces, getSpace, joinSpace, leaveSpace } from "../../lib/spaces.js";
import { resolveIdentity } from "../../lib/identity.js";
import { recordReadReceiptsBatch } from "../../lib/messages.js";
import { getConversationSummary } from "../../lib/summary.js";

export function registerSpaceTools(server: McpServer): void {

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

  server.registerTool("set_space_topic", {
    description: "Set the current topic/status of a space. Separate from the static description — use this for live status like '\ud83d\udd34 blocked on auth' or '\u2705 shipping v2'.",
    inputSchema: {
      space: z.string().describe("Space name"),
      topic: z.string().nullable().describe("New topic/status. Pass null to clear."),
    },
  }, async (args: Record<string, any>) => {
    const db = (await import("../../lib/db.js")).getDb();
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
    const db = (await import("../../lib/db.js")).getDb();
    const row = db.prepare("SELECT topic FROM spaces WHERE name = ?").get(args.space) as { topic: string | null } | null;
    if (!row) return { content: [{ type: "text", text: `Space not found: ${args.space}` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify({ space: args.space, topic: row.topic }) }] };
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
    const db = (await import("../../lib/db.js")).getDb();

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
      parts.push(`\n\u26d4 ${blockers.length} blocking message(s):`);
      for (const b of blockers.slice(0, 5)) {
        parts.push(`  \u2022 [#${b.id}] ${b.from}: ${b.content}${b.content.length > 150 ? "..." : ""}`);
      }
    }

    // Recent key messages (high priority or replies)
    const highPri = rows.filter((m) => m.priority === "high" || m.priority === "urgent").slice(0, 5);
    if (highPri.length > 0) {
      parts.push(`\n\ud83d\udd34 High priority (${highPri.length}):`);
      for (const m of highPri) {
        parts.push(`  \u2022 [${m.priority}] ${m.from_agent}: ${(m.content as string).slice(0, 100)}`);
      }
    }

    parts.push(`\nLast message: ${(rows[0]?.created_at as string)?.slice(0, 16) ?? "?"}`);

    return { content: [{ type: "text", text: parts.join("\n") }] };
  });
}
