#!/usr/bin/env bun
/**
 * messages — the CLI surface of @hasna/messages.
 *
 * Interface layer over the single domain implementation. Local mode uses a
 * local SQLite store and is an EXPLICIT opt-in (HASNA_MESSAGES_LOCAL=1);
 * `--url` / HASNA_MESSAGES_API_URL targets a running messages-serve instance
 * through the SDK client. Without the API env AND without the local opt-in
 * the CLI fails closed (non-zero exit, actionable error) — it never silently
 * falls back to the on-box store. Agent identity is
 * first-class: acting verbs take --agent, and `messages register` / `messages
 * agents` manage the identity registry.
 *
 * The delivery repair is exposed as verbs: `messages send` records per-
 * recipient delivery state 'stored'; `messages receive` drains the inbox
 * (stored -> delivered); `messages read` marks it read; `messages delivery`
 * shows the per-recipient state so a stored-but-undelivered message is
 * distinguishable from a delivered one.
 */
import { Command } from "commander";
import {
  createMessagesClient,
  MESSAGES_API_KEY_ENV,
  MESSAGES_API_URL_ENV,
  resolveMessagesClientTransport,
} from "../sdk";
import { MessagesService } from "../service";
import { SqliteMessagesStore } from "../server/sqlite-store";
import { version } from "../version";

function print(obj: unknown): void {
  console.log(JSON.stringify(obj, null, 2));
}

interface CliOpts {
  url?: string;
  apiKey?: string;
}

/**
 * Resolve the client transport from CLI overrides + env. Fails closed when
 * neither the API env nor the explicit local opt-in (HASNA_MESSAGES_LOCAL=1)
 * is present: resolveMessagesClientTransport throws and the top-level handler
 * below exits non-zero with the actionable error.
 */
function resolveStore(opts: CliOpts): { transport: "http" | "local"; local?: MessagesService; remote?: ReturnType<typeof createMessagesClient> } {
  const env: Record<string, string | undefined> = {
    ...process.env,
    [MESSAGES_API_URL_ENV]: opts.url ?? process.env[MESSAGES_API_URL_ENV],
    [MESSAGES_API_KEY_ENV]: opts.apiKey ?? process.env[MESSAGES_API_KEY_ENV],
  };
  const report = resolveMessagesClientTransport(env);
  if (report.transport === "http") {
    return { transport: "http", remote: createMessagesClient(env) };
  }
  return { transport: "local", local: new MessagesService(new SqliteMessagesStore()) };
}

const program = new Command();

program
  .name("messages")
  .description("Direct agent-to-agent messaging with threads (DMs + DM-threads)")
  .version(version);

// --- identity --------------------------------------------------------------

program
  .command("register")
  .description("Register (or return) an agent identity")
  .requiredOption("--name <agent>", "agent name")
  .option("--display-name <text>", "human/seat-friendly label")
  .option("--url <url>", "messages-serve base URL (overrides HASNA_MESSAGES_API_URL; local mode requires HASNA_MESSAGES_LOCAL=1)")
  .option("--api-key <key>", "API key for the remote server")
  .action(async (opts: { name: string; displayName?: string } & CliOpts) => {
    const store = resolveStore(opts);
    if (store.transport === "http") {
      print(await store.remote!.registerAgent(opts.name, opts.displayName));
      return;
    }
    print({ agent: await store.local!.registerAgent(opts.name, opts.displayName) });
  });

program
  .command("agents")
  .description("List registered agent identities")
  .option("--url <url>", "messages-serve base URL (overrides HASNA_MESSAGES_API_URL; local mode requires HASNA_MESSAGES_LOCAL=1)")
  .option("--api-key <key>", "API key for the remote server")
  .action(async (opts: CliOpts) => {
    const store = resolveStore(opts);
    const agents = store.transport === "http" ? (await store.remote!.listAgents()).agents : await store.local!.listAgents();
    print(agents);
  });

program
  .command("whoami")
  .description("Show an agent identity (or register it if absent)")
  .requiredOption("--agent <agent>", "agent name")
  .option("--url <url>", "messages-serve base URL (overrides HASNA_MESSAGES_API_URL; local mode requires HASNA_MESSAGES_LOCAL=1)")
  .option("--api-key <key>", "API key for the remote server")
  .action(async (opts: { agent: string } & CliOpts) => {
    const store = resolveStore(opts);
    const agent = store.transport === "http"
      ? (await store.remote!.registerAgent(opts.agent)).agent
      : await store.local!.registerAgent(opts.agent);
    print(agent);
  });

// --- messaging -------------------------------------------------------------

program
  .command("send")
  .description("Send a direct message from one agent to another (per-recipient delivery state 'stored')")
  .requiredOption("--from <agent>", "sending agent")
  .requiredOption("--to <agent>", "receiving agent")
  .requiredOption("--content <text>", "message body")
  .option("--reply-to <id>", "message id being replied to (threads)")
  .option("--url <url>", "messages-serve base URL (overrides HASNA_MESSAGES_API_URL; local mode requires HASNA_MESSAGES_LOCAL=1)")
  .option("--api-key <key>", "API key for the remote server")
  .action(async (opts: { from: string; to: string; content: string; replyTo?: string } & CliOpts) => {
    const store = resolveStore(opts);
    const result = store.transport === "http"
      ? await store.remote!.send(opts.from, opts.to, opts.content, opts.replyTo)
      : await store.local!.send({ from_agent: opts.from, to_agent: opts.to, content: opts.content, reply_to: opts.replyTo ?? null });
    print(result);
  });

program
  .command("receive")
  .description("Drain the agent's inbox: transition stored -> delivered and print the delivered messages")
  .requiredOption("--agent <agent>", "the agent receiving")
  .option("--url <url>", "messages-serve base URL (overrides HASNA_MESSAGES_API_URL; local mode requires HASNA_MESSAGES_LOCAL=1)")
  .option("--api-key <key>", "API key for the remote server")
  .action(async (opts: { agent: string } & CliOpts) => {
    const store = resolveStore(opts);
    const messages = store.transport === "http"
      ? (await store.remote!.receive(opts.agent)).messages
      : await store.local!.receive(opts.agent);
    print(messages);
  });

program
  .command("delivery")
  .description("Show per-recipient delivery state for a thread (stored | delivered | read)")
  .requiredOption("--id <threadId>", "thread id")
  .option("--url <url>", "messages-serve base URL (overrides HASNA_MESSAGES_API_URL; local mode requires HASNA_MESSAGES_LOCAL=1)")
  .option("--api-key <key>", "API key for the remote server")
  .action(async (opts: { id: string } & CliOpts) => {
    const store = resolveStore(opts);
    const deliveries = store.transport === "http"
      ? (await store.remote!.deliveryStatus(opts.id)).deliveries
      : await store.local!.deliveryStatus(opts.id);
    print(deliveries);
  });

// --- threads ---------------------------------------------------------------

program
  .command("threads")
  .description("List threads involving an agent, with unread counts")
  .requiredOption("--agent <agent>", "the agent whose threads to list")
  .option("--all", "include threads the agent has closed")
  .option("--url <url>", "messages-serve base URL (overrides HASNA_MESSAGES_API_URL; local mode requires HASNA_MESSAGES_LOCAL=1)")
  .option("--api-key <key>", "API key for the remote server")
  .action(async (opts: { agent: string; all?: boolean } & CliOpts) => {
    const store = resolveStore(opts);
    const threads = store.transport === "http"
      ? (await store.remote!.threads(opts.agent, !opts.all)).threads
      : await store.local!.threads(opts.agent, { openOnly: !opts.all });
    print(threads);
  });

program
  .command("thread")
  .description("Expand a thread: its messages with your per-message delivery state (does NOT mark read)")
  .requiredOption("--id <threadId>", "thread id")
  .requiredOption("--agent <agent>", "the agent expanding")
  .option("--url <url>", "messages-serve base URL (overrides HASNA_MESSAGES_API_URL; local mode requires HASNA_MESSAGES_LOCAL=1)")
  .option("--api-key <key>", "API key for the remote server")
  .action(async (opts: { id: string; agent: string } & CliOpts) => {
    const store = resolveStore(opts);
    const result = store.transport === "http"
      ? await store.remote!.thread(opts.id, opts.agent)
      : await store.local!.expandThread(opts.id, opts.agent);
    print(result);
  });

program
  .command("unread")
  .description("List threads with unread messages for an agent (and the total)")
  .requiredOption("--agent <agent>", "the agent")
  .option("--url <url>", "messages-serve base URL (overrides HASNA_MESSAGES_API_URL; local mode requires HASNA_MESSAGES_LOCAL=1)")
  .option("--api-key <key>", "API key for the remote server")
  .action(async (opts: { agent: string } & CliOpts) => {
    const store = resolveStore(opts);
    if (store.transport === "http") {
      print(await store.remote!.unread(opts.agent));
      return;
    }
    const threads = await store.local!.unreadThreads(opts.agent);
    print({ threads, total: threads.reduce((sum, t) => sum + t.unread_count, 0) });
  });

program
  .command("read")
  .description("Mark a thread read from an agent's perspective (stored/delivered -> read)")
  .requiredOption("--id <threadId>", "thread id")
  .requiredOption("--agent <agent>", "the agent marking it read")
  .option("--url <url>", "messages-serve base URL (overrides HASNA_MESSAGES_API_URL; local mode requires HASNA_MESSAGES_LOCAL=1)")
  .option("--api-key <key>", "API key for the remote server")
  .action(async (opts: { id: string; agent: string } & CliOpts) => {
    const store = resolveStore(opts);
    if (store.transport === "http") {
      await store.remote!.markRead(opts.id, opts.agent);
    } else {
      await store.local!.markRead(opts.id, opts.agent);
    }
    print({ ok: true, thread_id: opts.id, agent: opts.agent });
  });

program
  .command("close")
  .description("Close a thread from an agent's perspective (excluded from the default list)")
  .requiredOption("--id <threadId>", "thread id")
  .requiredOption("--agent <agent>", "the agent closing it")
  .option("--url <url>", "messages-serve base URL (overrides HASNA_MESSAGES_API_URL; local mode requires HASNA_MESSAGES_LOCAL=1)")
  .option("--api-key <key>", "API key for the remote server")
  .action(async (opts: { id: string; agent: string } & CliOpts) => {
    const store = resolveStore(opts);
    const thread = store.transport === "http"
      ? (await store.remote!.closeThread(opts.id, opts.agent)).thread
      : await store.local!.closeThread(opts.id, opts.agent);
    print({ ok: true, thread });
  });

program
  .command("reopen")
  .description("Reopen a thread from an agent's perspective")
  .requiredOption("--id <threadId>", "thread id")
  .requiredOption("--agent <agent>", "the agent reopening it")
  .option("--url <url>", "messages-serve base URL (overrides HASNA_MESSAGES_API_URL; local mode requires HASNA_MESSAGES_LOCAL=1)")
  .option("--api-key <key>", "API key for the remote server")
  .action(async (opts: { id: string; agent: string } & CliOpts) => {
    const store = resolveStore(opts);
    const thread = store.transport === "http"
      ? (await store.remote!.reopenThread(opts.id, opts.agent)).thread
      : await store.local!.reopenThread(opts.id, opts.agent);
    print({ ok: true, thread });
  });

// --- server ----------------------------------------------------------------

program
  .command("serve")
  .description("Start the messages-serve HTTP API")
  .action(async () => {
    const { serve } = await import("../server/serve-entry");
    await serve();
  });

// Fail-closed top-level: a transport misconfiguration (API env AND local
// opt-in both absent) throws out of the action handler; print the actionable
// error to stderr and exit non-zero. Never fall back to a local store with
// exit 0.
try {
  await program.parseAsync(process.argv);
} catch (err) {
  console.error(`messages: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
