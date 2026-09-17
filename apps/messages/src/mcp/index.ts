#!/usr/bin/env bun
/**
 * messages-mcp — the MCP surface of @hasna/messages.
 *
 * Thin interface layer over the single domain implementation: the SDK client
 * through the shared @hasna/contracts resolver (credential + authority
 * resolved per tool call, fresh — hasna/apps#1720), or the local SQLite store
 * — an EXPLICIT opt-in (HASNA_MESSAGES_LOCAL=1) only. Hosted with no
 * credential the server fails closed at startup (non-zero exit + actionable
 * error); it never silently serves the on-box store. Tools:
 *   messages_register, messages_agents, messages_send, messages_threads,
 *   messages_thread, messages_unread, messages_thread_close,
 *   messages_thread_reopen, messages_mark_read, messages_receive,
 *   messages_delivery
 *
 * Binds-before-version (control surfaces answer --version/--help before any
 * stdio framing — the same class as the recent control-surface fixes): the
 * version/help checks run before the MCP server connects to stdio.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createMessagesClient, resolveMessagesClientTransport } from "../sdk";
import type { MessagesClient } from "../sdk";
import type { MessagesService } from "../service";
import { loadLocalMessagesService } from "../local-store-loader";
import { version } from "../version";

// Binds-before-version: --version/-V/--help answer before the stdio framing
// loop (silent-empty family).
const EARLY_ARGV = process.argv.slice(2);
if (EARLY_ARGV.includes("--version") || EARLY_ARGV.includes("-V")) {
  console.log(version);
  process.exit(0);
}
if (EARLY_ARGV.includes("--help") || EARLY_ARGV.includes("-h")) {
  console.log(`Usage: messages-mcp [options]

Hasna Messages MCP server (stdio) — direct agent-to-agent DMs with threads.

Credentials and the API authority resolve through the shared @hasna/contracts
chain (Keychain, ~/.hasna/messages/config/credentials, HASNA_MESSAGES_API_KEY;
authority defaults to https://api.hasna.com/messages). Hosted with no
credential the server exits non-zero; HASNA_MESSAGES_LOCAL=1 explicitly serves
the on-box SQLite store.

Options:
  -V, --version  output the version number
  -h, --help     display help for command`);
  process.exit(0);
}

// Fail-closed gate (after the binds-before-version early exits, before the
// stdio connect): a host/credential misconfiguration is fatal at startup. The
// resolver throws when neither a credential resolves nor the explicit local
// opt-in is present — never open the on-box store silently and exit 0.
try {
  resolveMessagesClientTransport(process.env);
} catch (err) {
  console.error(`messages-mcp: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

/**
 * The resolved service for one tool call, TAGGED by transport.
 *
 * The tag replaces the old `instanceof MessagesService` dispatch on purpose:
 * the local service now arrives from a dynamically imported module
 * (`src/local-store.ts`, kept out of this bundle so `bin/mcp.js` links no
 * SQLite engine), and a class identity does not survive a module boundary.
 */
type Service =
  | { transport: "http"; client: MessagesClient }
  | { transport: "local"; service: MessagesService };

/**
 * The service for ONE tool call, resolved fresh — the resolver consults the
 * Keychain and the credential file at every call, so a rotation heals a
 * long-lived server without a restart. The on-box store is reached only
 * through the gated loader, so no tool can open SQLite without the explicit
 * HASNA_MESSAGES_LOCAL=1 opt-in.
 */
async function service(): Promise<Service> {
  const report = resolveMessagesClientTransport(process.env);
  if (report.transport === "http") {
    const client = createMessagesClient(process.env);
    if (!client) throw new Error("HTTP transport resolved but no client could be created");
    return { transport: "http", client };
  }
  return { transport: "local", service: await loadLocalMessagesService(process.env) };
}

async function registerAgent(svc: Service, name: string, displayName?: string) {
  if (svc.transport === "local") {
    return { agent: await svc.service.registerAgent(name, displayName) };
  }
  return svc.client.registerAgent(name, displayName);
}

async function listAgents(svc: Service) {
  if (svc.transport === "local") return { agents: await svc.service.listAgents() };
  return svc.client.listAgents();
}

async function send(svc: Service, args: { from: string; to: string; content: string; replyTo?: string }) {
  if (svc.transport === "local") {
    return svc.service.send({ from_agent: args.from, to_agent: args.to, content: args.content, reply_to: args.replyTo ?? null });
  }
  return svc.client.send(args.from, args.to, args.content, args.replyTo);
}

async function threads(svc: Service, agent: string, openOnly: boolean) {
  if (svc.transport === "local") return { threads: await svc.service.threads(agent, { openOnly }) };
  return svc.client.threads(agent, openOnly);
}

async function expandThread(svc: Service, threadId: string, agent: string) {
  if (svc.transport === "local") return svc.service.expandThread(threadId, agent);
  return svc.client.thread(threadId, agent);
}

async function unread(svc: Service, agent: string) {
  if (svc.transport === "local") {
    const list = await svc.service.unreadThreads(agent);
    return { threads: list, total: list.reduce((sum, t) => sum + t.unread_count, 0) };
  }
  return svc.client.unread(agent);
}

async function closeThread(svc: Service, threadId: string, agent: string) {
  if (svc.transport === "local") return { thread: await svc.service.closeThread(threadId, agent) };
  return svc.client.closeThread(threadId, agent);
}

async function reopenThread(svc: Service, threadId: string, agent: string) {
  if (svc.transport === "local") return { thread: await svc.service.reopenThread(threadId, agent) };
  return svc.client.reopenThread(threadId, agent);
}

async function markRead(svc: Service, threadId: string, agent: string) {
  if (svc.transport === "local") return svc.service.markRead(threadId, agent);
  return svc.client.markRead(threadId, agent);
}

async function receive(svc: Service, agent: string) {
  if (svc.transport === "local") return { messages: await svc.service.receive(agent) };
  return svc.client.receive(agent);
}

async function deliveryStatus(svc: Service, threadId: string) {
  if (svc.transport === "local") return { deliveries: await svc.service.deliveryStatus(threadId) };
  return svc.client.deliveryStatus(threadId);
}

const server = new McpServer({
  name: "messages",
  version,
});

server.registerTool(
  "messages_register",
  {
    title: "Register an agent identity",
    description: "Register (or return) an agent identity. Agent identity is first-class: messages are addressed by registered agent names.",
    inputSchema: {
      name: z.string().describe("Agent name"),
      displayName: z.string().optional().describe("Human/seat-friendly label"),
    },
  },
  async (args) => {
    const result = await registerAgent(await service(), args.name, args.displayName);
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  },
);

server.registerTool(
  "messages_agents",
  {
    title: "List agents",
    description: "List registered agent identities.",
    inputSchema: {},
  },
  async () => {
    const result = await listAgents(await service());
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  },
);

server.registerTool(
  "messages_send",
  {
    title: "Send a direct message",
    description: "Send a direct message from one agent to another, creating or continuing a thread. The recipient's delivery state starts 'stored' — it becomes 'delivered' when they drain their inbox (messages_receive) and 'read' when they mark it read.",
    inputSchema: {
      from: z.string().describe("Sending agent"),
      to: z.string().describe("Receiving agent"),
      content: z.string().describe("Message body"),
      replyTo: z.string().optional().describe("Message id being replied to (threads)"),
    },
  },
  async (args) => {
    const result = await send(await service(), args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  },
);

server.registerTool(
  "messages_threads",
  {
    title: "List threads",
    description: "List threads involving an agent, with unread counts and closed state.",
    inputSchema: {
      agent: z.string().describe("The agent whose threads to list"),
      openOnly: z.boolean().optional().describe("Exclude closed threads (default true)"),
    },
  },
  async (args) => {
    const result = await threads(await service(), args.agent, args.openOnly ?? true);
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  },
);

server.registerTool(
  "messages_thread",
  {
    title: "Expand a thread",
    description: "Expand a thread: its messages (oldest first) with the requesting agent's per-message delivery state. Does NOT mark anything read.",
    inputSchema: {
      threadId: z.string().describe("Thread id"),
      agent: z.string().describe("The agent expanding"),
    },
  },
  async (args) => {
    const result = await expandThread(await service(), args.threadId, args.agent);
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  },
);

server.registerTool(
  "messages_unread",
  {
    title: "Unread threads",
    description: "List threads with unread messages for an agent (and the total).",
    inputSchema: { agent: z.string().describe("The agent") },
  },
  async (args) => {
    const result = await unread(await service(), args.agent);
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  },
);

server.registerTool(
  "messages_thread_close",
  {
    title: "Close a thread",
    description: "Close a thread from an agent's perspective (excluded from the default thread list; reopen to bring it back).",
    inputSchema: {
      threadId: z.string().describe("Thread id"),
      agent: z.string().describe("The agent closing it"),
    },
  },
  async (args) => {
    const result = await closeThread(await service(), args.threadId, args.agent);
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  },
);

server.registerTool(
  "messages_thread_reopen",
  {
    title: "Reopen a thread",
    description: "Reopen a thread from an agent's perspective.",
    inputSchema: {
      threadId: z.string().describe("Thread id"),
      agent: z.string().describe("The agent reopening it"),
    },
  },
  async (args) => {
    const result = await reopenThread(await service(), args.threadId, args.agent);
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  },
);

server.registerTool(
  "messages_mark_read",
  {
    title: "Mark a thread read",
    description: "Mark a thread read from an agent's perspective (stored/delivered -> read).",
    inputSchema: {
      threadId: z.string().describe("Thread id"),
      agent: z.string().describe("The agent marking it read"),
    },
  },
  async (args) => {
    await markRead(await service(), args.threadId, args.agent);
    return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true }) }] };
  },
);

server.registerTool(
  "messages_receive",
  {
    title: "Receive (drain) delivered messages",
    description: "Drain the agent's inbox: transition stored -> delivered for the agent's undelivered messages and return them. This is the delivery verb that distinguishes a stored-but-undelivered message from a delivered one.",
    inputSchema: { agent: z.string().describe("The agent receiving") },
  },
  async (args) => {
    const result = await receive(await service(), args.agent);
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  },
);

server.registerTool(
  "messages_delivery",
  {
    title: "Delivery status",
    description: "Show per-message per-recipient delivery state for a thread (stored | delivered | read). The sender's view of whether each message was actually delivered.",
    inputSchema: { threadId: z.string().describe("Thread id") },
  },
  async (args) => {
    const result = await deliveryStatus(await service(), args.threadId);
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  },
);

await server.connect(new StdioServerTransport());
