#!/usr/bin/env bun
/**
 * MCP server for conversations.
 * Exposes tools for sending, reading, and managing messages between agents.
 *
 * Usage:
 *   convo mcp          # Start MCP server on stdio
 *   convo-mcp          # Direct binary
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { sendMessage, readMessages, markRead, getMessageById } from "../lib/messages.js";
import { listSessions } from "../lib/sessions.js";
import { resolveIdentity } from "../lib/identity.js";

const server = new McpServer({
  name: "conversations",
  version: "0.0.1",
});

// ---- Tools ----

server.registerTool("send_message", {
  title: "Send Message",
  description: "Send a message to another agent. The sender is auto-resolved from CONVERSATIONS_AGENT_ID env var.",
  inputSchema: {
    to: z.string().describe("Recipient agent ID"),
    content: z.string().describe("Message content"),
    session_id: z.string().optional().describe("Session ID (auto-generated if omitted)"),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional().describe("Message priority"),
    working_dir: z.string().optional().describe("Working directory context"),
    repository: z.string().optional().describe("Repository context"),
    branch: z.string().optional().describe("Branch context"),
    metadata: z.string().optional().describe("JSON metadata string"),
  },
}, async ({ to, content, session_id, priority, working_dir, repository, branch, metadata }) => {
  const from = resolveIdentity();
  const parsedMetadata = metadata ? JSON.parse(metadata) : undefined;

  const msg = sendMessage({
    from,
    to,
    content,
    session_id,
    priority,
    working_dir,
    repository,
    branch,
    metadata: parsedMetadata,
  });

  return {
    content: [{ type: "text", text: JSON.stringify(msg, null, 2) }],
  };
});

server.registerTool("read_messages", {
  title: "Read Messages",
  description: "Read messages with optional filters. Returns messages sorted by time.",
  inputSchema: {
    session_id: z.string().optional().describe("Filter by session ID"),
    from: z.string().optional().describe("Filter by sender agent ID"),
    to: z.string().optional().describe("Filter by recipient agent ID"),
    since: z.string().optional().describe("Messages after this ISO timestamp"),
    limit: z.number().optional().describe("Max messages to return"),
    unread_only: z.boolean().optional().describe("Only return unread messages"),
  },
}, async (opts) => {
  const messages = readMessages(opts);

  return {
    content: [{ type: "text", text: JSON.stringify(messages, null, 2) }],
  };
});

server.registerTool("list_sessions", {
  title: "List Sessions",
  description: "List conversation sessions, optionally filtered to a specific agent.",
  inputSchema: {
    agent: z.string().optional().describe("Filter sessions involving this agent"),
  },
}, async ({ agent }) => {
  const sessions = listSessions(agent);

  return {
    content: [{ type: "text", text: JSON.stringify(sessions, null, 2) }],
  };
});

server.registerTool("reply", {
  title: "Reply to Message",
  description: "Reply to a message by its ID. Automatically uses the same session and sends to the original sender.",
  inputSchema: {
    message_id: z.number().describe("ID of the message to reply to"),
    content: z.string().describe("Reply content"),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional().describe("Message priority"),
  },
}, async ({ message_id, content, priority }) => {
  const original = getMessageById(message_id);
  if (!original) {
    return {
      content: [{ type: "text", text: `Message #${message_id} not found` }],
      isError: true,
    };
  }

  const from = resolveIdentity();
  const msg = sendMessage({
    from,
    to: original.from_agent,
    content,
    session_id: original.session_id,
    priority,
  });

  return {
    content: [{ type: "text", text: JSON.stringify(msg, null, 2) }],
  };
});

server.registerTool("mark_read", {
  title: "Mark Read",
  description: "Mark message IDs as read for the current agent.",
  inputSchema: {
    ids: z.array(z.number()).describe("Message IDs to mark as read"),
  },
}, async ({ ids }) => {
  const agent = resolveIdentity();
  const count = markRead(ids, agent);

  return {
    content: [{ type: "text", text: JSON.stringify({ marked_read: count }, null, 2) }],
  };
});

// ---- Start server ----

export async function startMcpServer() {
  const transport = new StdioServerTransport();
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
