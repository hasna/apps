#!/usr/bin/env bun
/**
 * messages-mcp — the MCP surface of @hasna/messages.
 *
 * Thin interface layer over MessagesService (single domain implementation)
 * via the local SQLite store, or over the SDK client when
 * HASNA_MESSAGES_API_URL is set. Tools:
 *   messages_send, messages_threads, messages_read, messages_mark_read
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolveCredential } from "@hasna/contracts/client";
import { MessagesService } from "../service";
import { SqliteMessagesStore } from "../server/sqlite-store";
import { MessagesClient } from "../sdk";

function service(): MessagesService | MessagesClient {
  const url = process.env.HASNA_MESSAGES_API_URL;
  if (url) {
    // Credential via the @hasna/contracts client seam — never a bare env read.
    const resolved = resolveCredential("messages", process.env as NodeJS.ProcessEnv, {});
    return new MessagesClient({ baseUrl: url, apiKey: resolved?.apiKey });
  }
  return new MessagesService(new SqliteMessagesStore());
}

async function send(svc: MessagesService | MessagesClient, args: { from: string; to: string; content: string; replyTo?: string }) {
  if (svc instanceof MessagesClient) {
    return svc.send(args.from, args.to, args.content, args.replyTo);
  }
  return svc.send({ from_agent: args.from, to_agent: args.to, content: args.content, reply_to: args.replyTo ?? null });
}

async function threads(svc: MessagesService | MessagesClient, agent: string) {
  if (svc instanceof MessagesClient) return svc.threads(agent);
  return svc.threads(agent);
}

async function threadMessages(svc: MessagesService | MessagesClient, threadId: string, limit?: number) {
  if (svc instanceof MessagesClient) return svc.threadMessages(threadId, limit);
  return svc.threadMessages(threadId, limit);
}

async function markRead(svc: MessagesService | MessagesClient, threadId: string, agent: string) {
  if (svc instanceof MessagesClient) return svc.markRead(threadId, agent);
  return svc.markRead(threadId, agent);
}

const server = new McpServer({
  name: "messages",
  version: "0.1.0",
});

server.registerTool(
  "messages_send",
  {
    title: "Send a direct message",
    description: "Send a direct message from one agent to another, creating or continuing a thread.",
    inputSchema: {
      from: z.string().describe("Sending agent"),
      to: z.string().describe("Receiving agent"),
      content: z.string().describe("Message body"),
      replyTo: z.string().optional().describe("Message id being replied to (threads)"),
    },
  },
  async (args) => {
    const result = await send(service(), args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  },
);

server.registerTool(
  "messages_threads",
  {
    title: "List threads",
    description: "List threads involving an agent, with unread counts.",
    inputSchema: { agent: z.string().describe("The agent whose threads to list") },
  },
  async (args) => {
    const result = await threads(service(), args.agent);
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  },
);

server.registerTool(
  "messages_read",
  {
    title: "Read a thread",
    description: "Read a thread's message history (oldest first).",
    inputSchema: {
      threadId: z.string().describe("Thread id"),
      limit: z.number().int().optional().describe("Message count limit"),
    },
  },
  async (args) => {
    const result = await threadMessages(service(), args.threadId, args.limit);
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  },
);

server.registerTool(
  "messages_mark_read",
  {
    title: "Mark a thread read",
    description: "Mark a thread read from an agent's perspective.",
    inputSchema: {
      threadId: z.string().describe("Thread id"),
      agent: z.string().describe("The agent marking it read"),
    },
  },
  async (args) => {
    await markRead(service(), args.threadId, args.agent);
    return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true }) }] };
  },
);

await server.connect(new StdioServerTransport());
