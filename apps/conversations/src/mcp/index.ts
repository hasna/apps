#!/usr/bin/env bun
/**
 * MCP server for conversations.
 * Exposes tools for sending, reading, and managing messages and channels between agents.
 *
 * Usage:
 *   convo mcp          # Start MCP server on stdio
 *   convo-mcp          # Direct binary
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { sendMessage, readMessages, markRead, markChannelRead, getMessageById } from "../lib/messages.js";
import { listSessions } from "../lib/sessions.js";
import { createChannel, listChannels, getChannel, joinChannel, leaveChannel, getChannelMembers } from "../lib/channels.js";
import { resolveIdentity } from "../lib/identity.js";

const server = new McpServer({
  name: "conversations",
  version: "0.0.3",
});

// ---- DM Tools ----

server.registerTool("send_message", {
  title: "Send Message",
  description: "Send a direct message to another agent. The sender is auto-resolved from CONVERSATIONS_AGENT_ID env var.",
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
    channel: z.string().optional().describe("Filter by channel name"),
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

// ---- Channel Tools ----

server.registerTool("create_channel", {
  title: "Create Channel",
  description: "Create a new channel. The creator is auto-joined.",
  inputSchema: {
    name: z.string().describe("Channel name (e.g. 'deployments', 'code-review')"),
    description: z.string().optional().describe("Channel description"),
  },
}, async ({ name, description }) => {
  const agent = resolveIdentity();
  try {
    const ch = createChannel(name, agent, description);
    return {
      content: [{ type: "text", text: JSON.stringify(ch, null, 2) }],
    };
  } catch (e: any) {
    if (e.message?.includes("UNIQUE constraint")) {
      return {
        content: [{ type: "text", text: `Channel #${name} already exists` }],
        isError: true,
      };
    }
    throw e;
  }
});

server.registerTool("list_channels", {
  title: "List Channels",
  description: "List all available channels with member and message counts.",
}, async () => {
  const channels = listChannels();

  return {
    content: [{ type: "text", text: JSON.stringify(channels, null, 2) }],
  };
});

server.registerTool("send_to_channel", {
  title: "Send to Channel",
  description: "Send a message to a channel. All members can see it.",
  inputSchema: {
    channel: z.string().describe("Channel name"),
    content: z.string().describe("Message content"),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional().describe("Message priority"),
  },
}, async ({ channel, content, priority }) => {
  const from = resolveIdentity();

  const ch = getChannel(channel);
  if (!ch) {
    return {
      content: [{ type: "text", text: `Channel #${channel} not found` }],
      isError: true,
    };
  }

  const msg = sendMessage({
    from,
    to: channel,
    content,
    channel,
    session_id: `channel:${channel}`,
    priority,
  });

  return {
    content: [{ type: "text", text: JSON.stringify(msg, null, 2) }],
  };
});

server.registerTool("read_channel", {
  title: "Read Channel",
  description: "Read messages from a channel.",
  inputSchema: {
    channel: z.string().describe("Channel name"),
    since: z.string().optional().describe("Messages after this ISO timestamp"),
    limit: z.number().optional().describe("Max messages to return"),
  },
}, async ({ channel, since, limit }) => {
  const messages = readMessages({ channel, since, limit });

  return {
    content: [{ type: "text", text: JSON.stringify(messages, null, 2) }],
  };
});

server.registerTool("join_channel", {
  title: "Join Channel",
  description: "Join a channel to receive messages.",
  inputSchema: {
    channel: z.string().describe("Channel name to join"),
  },
}, async ({ channel }) => {
  const agent = resolveIdentity();
  const ok = joinChannel(channel, agent);

  if (!ok) {
    return {
      content: [{ type: "text", text: `Channel #${channel} not found` }],
      isError: true,
    };
  }

  return {
    content: [{ type: "text", text: JSON.stringify({ channel, agent, joined: true }, null, 2) }],
  };
});

server.registerTool("leave_channel", {
  title: "Leave Channel",
  description: "Leave a channel.",
  inputSchema: {
    channel: z.string().describe("Channel name to leave"),
  },
}, async ({ channel }) => {
  const agent = resolveIdentity();
  const left = leaveChannel(channel, agent);

  return {
    content: [{ type: "text", text: JSON.stringify({ channel, agent, left }, null, 2) }],
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
