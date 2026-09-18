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
import {
  createMessagesClient,
  resolveMessagesClientTransport,
} from "../sdk";
import type { MessagesClient } from "../sdk";
import type { MessagesService } from "../service";
import { loadLocalMessagesService } from "../local-store-loader";
import { version } from "../version";
import {
  collectionPage,
  compactAgent,
  compactDeliveryReport,
  compactDiscoveredAgent,
  compactInboxItem,
  compactMessage,
  compactThread,
} from "../compact-output.js";

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
  console.error(
    `messages-mcp: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
}

type Service =
  | { transport: "http"; client: MessagesClient }
  | { transport: "local"; service: MessagesService };

/**
 * The service for ONE tool call, resolved fresh — the resolver consults the
 * Keychain and the credential file at every call, so a rotation heals a
 * long-lived server without a restart. The local service is loaded through
 * the same explicit-opt-in gate as the CLI and SDK, keeping SQLite out of the
 * MCP client bundle.
 */
async function service(): Promise<Service> {
  const report = resolveMessagesClientTransport(process.env);
  if (report.transport === "http") {
    const client = createMessagesClient(process.env);
    if (!client)
      throw new Error("HTTP transport resolved but no client could be created");
    return { transport: "http", client };
  }
  return {
    transport: "local",
    service: await loadLocalMessagesService(process.env),
  };
}

async function discoverAgents(
  svc: Service,
  args: Parameters<MessagesClient["discoverAgents"]>[0],
) {
  return svc.transport === "local"
    ? svc.service.discoverAgents(args)
    : svc.client.discoverAgents(args);
}

async function heartbeat(
  svc: Service,
  args: Parameters<MessagesClient["heartbeat"]>[0],
) {
  return svc.transport === "local"
    ? svc.service.heartbeat(args)
    : svc.client.heartbeat(args);
}

async function runtimeInbox(svc: Service, runtimeId: string, limit?: number) {
  return svc.transport === "local"
    ? svc.service.runtimeInbox(runtimeId, limit)
    : svc.client.runtimeInbox(runtimeId, limit);
}

async function acknowledge(
  svc: Service,
  runtimeId: string,
  messageIds: string[],
) {
  return svc.transport === "local"
    ? svc.service.acknowledge(runtimeId, messageIds)
    : svc.client.acknowledge(runtimeId, messageIds);
}

async function registerAgent(svc: Service, name: string, displayName?: string) {
  if (svc.transport === "local") {
    return { agent: await svc.service.registerAgent(name, displayName) };
  }
  return svc.client.registerAgent(name, displayName);
}

async function listAgents(svc: Service) {
  if (svc.transport === "local") {
    return { agents: await svc.service.listAgents() };
  }
  return svc.client.listAgents();
}

async function send(
  svc: Service,
  args: {
    from: string;
    to: string;
    content: string;
    replyTo?: string;
    idempotencyKey?: string;
  },
) {
  if (svc.transport === "local") {
    return svc.service.send({
      from_agent: args.from,
      to_agent: args.to,
      content: args.content,
      reply_to: args.replyTo ?? null,
      idempotency_key: args.idempotencyKey,
    });
  }
  return svc.client.send(
    args.from,
    args.to,
    args.content,
    args.replyTo,
    args.idempotencyKey,
  );
}

async function threads(svc: Service, agent: string, openOnly: boolean) {
  if (svc.transport === "local") {
    return { threads: await svc.service.threads(agent, { openOnly }) };
  }
  return svc.client.threads(agent, openOnly);
}

async function expandThread(svc: Service, threadId: string, agent: string) {
  if (svc.transport === "local") {
    return svc.service.expandThread(threadId, agent);
  }
  return svc.client.thread(threadId, agent);
}

async function unread(svc: Service, agent: string) {
  if (svc.transport === "local") {
    const list = await svc.service.unreadThreads(agent);
    return {
      threads: list,
      total: list.reduce((sum, thread) => sum + thread.unread_count, 0),
    };
  }
  return svc.client.unread(agent);
}

async function closeThread(svc: Service, threadId: string, agent: string) {
  if (svc.transport === "local") {
    return { thread: await svc.service.closeThread(threadId, agent) };
  }
  return svc.client.closeThread(threadId, agent);
}

async function reopenThread(svc: Service, threadId: string, agent: string) {
  if (svc.transport === "local") {
    return { thread: await svc.service.reopenThread(threadId, agent) };
  }
  return svc.client.reopenThread(threadId, agent);
}

async function markRead(svc: Service, threadId: string, agent: string) {
  if (svc.transport === "local") {
    return svc.service.markRead(threadId, agent);
  }
  return svc.client.markRead(threadId, agent);
}

async function receive(svc: Service, agent: string, limit?: number, full = false) {
  if (svc.transport === "local") {
    return { messages: await svc.service.receive(agent, limit) };
  }
  return svc.client.receive(agent, limit, full);
}

async function deliveryStatus(svc: Service, threadId: string) {
  if (svc.transport === "local") {
    return { deliveries: await svc.service.deliveryStatus(threadId) };
  }
  return svc.client.deliveryStatus(threadId);
}

const collectionSchema = {
  limit: z.number().int().min(1).max(100).optional().describe("Max returned rows (default 20)"),
  cursor: z.number().int().min(0).optional().describe("Zero-based row offset"),
  verbose: z.boolean().optional().describe("Return full fields within the selected page"),
  full: z.boolean().optional().describe("Return the legacy complete response"),
};

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

const server = new McpServer({
  name: "messages",
  version,
});

server.registerTool(
  "messages_discover",
  {
    title: "Discover agents across stations",
    description:
      "Find registered peers by station, application, name or receiver availability. Offline identities remain addressable. online means the receiver is reachable, not that a model is busy. Use next_cursor for the next page.",
    inputSchema: {
      search: z.string().optional(),
      station: z.string().optional(),
      application: z.string().optional(),
      online: z.boolean().optional(),
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(500).optional(),
      verbose: z.boolean().optional().describe("Return full discovery records within the selected page"),
      full: z.boolean().optional().describe("Return the legacy full-field response and legacy default page size"),
    },
  },
  async ({ verbose, full, ...args }) => {
    const page = await discoverAgents(await service(), { ...args, limit: full ? args.limit : (args.limit ?? 20) });
    if (verbose || full) return result({ ...page, compact: false });
    return result({ ...page, agents: page.agents.map(compactDiscoveredAgent), compact: true });
  },
);

server.registerTool(
  "messages_heartbeat",
  {
    title: "Advertise a receiving runtime",
    description:
      "Runtime integration: advertise hosted agents with station and application labels. Presence expires after 90 seconds; renew only while this runtime can receive. Conflicting live owners are refused.",
    inputSchema: {
      runtime_id: z.string(),
      station: z.string().optional(),
      application: z.string().optional(),
      agents: z
        .array(
          z.object({ name: z.string(), display_name: z.string().optional() }),
        )
        .min(1)
        .max(500),
    },
  },
  async (args) => ({
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(await heartbeat(await service(), args)),
      },
    ],
  }),
);

server.registerTool(
  "messages_inbox",
  {
    title: "Read a runtime inbox",
    description:
      "Read pending messages for a receiving runtime without consuming them. Save each message durably before messages_ack. Interrupted reads can be replayed.",
    inputSchema: {
      runtime_id: z.string(),
      limit: z.number().int().min(1).max(500).optional(),
      verbose: z.boolean().optional().describe("Return full message and delivery records within the selected batch"),
      full: z.boolean().optional().describe("Return the legacy full-field response and legacy default batch size"),
    },
  },
  async (args) => {
    const inbox = await runtimeInbox(await service(), args.runtime_id, args.full ? args.limit : (args.limit ?? 20));
    if (args.verbose || args.full) return result({ ...inbox, compact: false });
    return result({ ...inbox, messages: inbox.messages.map(compactInboxItem), compact: true });
  },
);

server.registerTool(
  "messages_ack",
  {
    title: "Acknowledge durable message admission",
    description:
      "Mark only messages saved by this runtime as delivered. Safe to repeat; never marks read or changes another runtime's deliveries.",
    inputSchema: {
      runtime_id: z.string(),
      message_ids: z.array(z.string()).min(1).max(500),
    },
  },
  async (args) => ({
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          await acknowledge(await service(), args.runtime_id, args.message_ids),
        ),
      },
    ],
  }),
);

server.registerTool(
  "messages_register",
  {
    title: "Register an agent identity",
    description:
      "Register (or return) an agent identity. Agent identity is first-class: messages are addressed by registered agent names.",
    inputSchema: {
      name: z.string().describe("Agent name"),
      displayName: z.string().optional().describe("Human/seat-friendly label"),
    },
  },
  async (args) => {
    const result = await registerAgent(await service(), args.name, args.displayName);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  },
);

server.registerTool(
  "messages_agents",
  {
    title: "List agents",
    description: "List registered agent identities with compact pagination by default.",
    inputSchema: collectionSchema,
  },
  async (args) => {
    const listed = await listAgents(await service());
    return result(args.full ? listed : collectionPage("agents", listed.agents, args, compactAgent));
  },
);

server.registerTool(
  "messages_send",
  {
    title: "Send a direct message",
    description:
      "Send a direct message from one agent to another, creating or continuing a thread. The recipient's delivery state starts 'stored' — it becomes 'delivered' when they drain their inbox (messages_receive) and 'read' when they mark it read.",
    inputSchema: {
      from: z.string().describe("Sending agent"),
      to: z.string().describe("Receiving agent"),
      content: z.string().describe("Message body"),
      replyTo: z
        .string()
        .optional()
        .describe("Message id being replied to (threads)"),
      idempotencyKey: z
        .string()
        .optional()
        .describe(
          "Stable key for retrying this exact send without creating a duplicate",
        ),
    },
  },
  async (args) => {
    const result = await send(await service(), args);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  },
);

server.registerTool(
  "messages_threads",
  {
    title: "List threads",
    description:
      "List threads involving an agent, with unread counts and closed state.",
    inputSchema: {
      agent: z.string().describe("The agent whose threads to list"),
      openOnly: z
        .boolean()
        .optional()
        .describe("Exclude closed threads (default true)"),
      ...collectionSchema,
    },
  },
  async (args) => {
    const listed = await threads(await service(), args.agent, args.openOnly ?? true);
    return result(args.full ? listed : collectionPage("threads", listed.threads, args, compactThread));
  },
);

server.registerTool(
  "messages_thread",
  {
    title: "Expand a thread",
    description:
      "Expand a thread: its messages (oldest first) with the requesting agent's per-message delivery state. Does NOT mark anything read.",
    inputSchema: {
      threadId: z.string().describe("Thread id"),
      agent: z.string().describe("The agent expanding"),
      ...collectionSchema,
    },
  },
  async (args) => {
    const expanded = await expandThread(await service(), args.threadId, args.agent);
    if (args.full) return result(expanded);
    const page = collectionPage("messages", expanded.messages, args, (entry) => ({
      message: compactMessage(entry.message),
      delivery_state: (entry.delivery as { state?: string } | null)?.state ?? null,
    }));
    return result({ thread: expanded.thread, unread_count: expanded.unread_count, ...page });
  },
);

server.registerTool(
  "messages_unread",
  {
    title: "Unread threads",
    description:
      "List threads with unread messages for an agent (and the total).",
    inputSchema: { agent: z.string().describe("The agent"), ...collectionSchema },
  },
  async (args) => {
    const unreadResult = await unread(await service(), args.agent);
    return result(args.full ? unreadResult : {
      unread_total: unreadResult.total,
      ...collectionPage("threads", unreadResult.threads, args, compactThread),
    });
  },
);

server.registerTool(
  "messages_thread_close",
  {
    title: "Close a thread",
    description:
      "Close a thread from an agent's perspective (excluded from the default thread list; reopen to bring it back).",
    inputSchema: {
      threadId: z.string().describe("Thread id"),
      agent: z.string().describe("The agent closing it"),
    },
  },
  async (args) => {
    const result = await closeThread(await service(), args.threadId, args.agent);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
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
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  },
);

server.registerTool(
  "messages_mark_read",
  {
    title: "Mark a thread read",
    description:
      "Mark a thread read from an agent's perspective (stored/delivered -> read).",
    inputSchema: {
      threadId: z.string().describe("Thread id"),
      agent: z.string().describe("The agent marking it read"),
    },
  },
  async (args) => {
    await markRead(await service(), args.threadId, args.agent);
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ ok: true }) }],
    };
  },
);

server.registerTool(
  "messages_receive",
  {
    title: "Receive (drain) delivered messages",
    description:
      "Drain the agent's inbox: transition stored -> delivered for the agent's undelivered messages and return them. This is the delivery verb that distinguishes a stored-but-undelivered message from a delivered one.",
    inputSchema: { agent: z.string().describe("The agent receiving"), limit: collectionSchema.limit, verbose: collectionSchema.verbose, full: collectionSchema.full },
  },
  async (args) => {
    const received = await receive(await service(), args.agent, args.full ? undefined : (args.limit ?? 20), Boolean(args.full));
    return result(args.full ? received : {
      messages: args.verbose ? received.messages : received.messages.map((message) => ({
        ...compactMessage(message),
        to_agent: message.to_agent,
        delivery_state: message.delivery.state,
      })),
      count: received.messages.length,
      limit: args.limit ?? 20,
      compact: !args.verbose,
      hint: "Call messages_receive again for the next batch; set full=true for the legacy complete drain.",
    });
  },
);

server.registerTool(
  "messages_delivery",
  {
    title: "Delivery status",
    description:
      "Show per-message per-recipient delivery state for a thread (stored | delivered | read). The sender's view of whether each message was actually delivered.",
    inputSchema: { threadId: z.string().describe("Thread id"), ...collectionSchema },
  },
  async (args) => {
    const delivery = await deliveryStatus(await service(), args.threadId);
    return result(args.full ? delivery : collectionPage("deliveries", delivery.deliveries, args, compactDeliveryReport));
  },
);

await server.connect(new StdioServerTransport());
