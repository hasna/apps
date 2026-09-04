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
  MESSAGES_LOCAL_MODE_ENV,
  isLocalModeOptIn,
  isPresent,
  resolveMessagesApiBase,
  resolveMessagesClientTransport,
} from "../sdk";
import { MessagesService } from "../service";
import { SqliteMessagesStore } from "../server/sqlite-store";
import { version } from "../version";
import { AGENT_DEFAULT_HINT, requireAgent } from "./identity";

function print(obj: unknown): void {
  console.log(JSON.stringify(obj, null, 2));
}

interface CliOpts {
  url?: string;
  apiKey?: string;
}

/** The process env with the per-invocation `--url` / `--api-key` overrides applied. */
function cliEnv(opts: CliOpts): Record<string, string | undefined> {
  return {
    ...process.env,
    [MESSAGES_API_URL_ENV]: opts.url ?? process.env[MESSAGES_API_URL_ENV],
    [MESSAGES_API_KEY_ENV]: opts.apiKey ?? process.env[MESSAGES_API_KEY_ENV],
  };
}

/**
 * Resolve the client transport from CLI overrides + env. Fails closed when
 * neither the API env nor the explicit local opt-in (HASNA_MESSAGES_LOCAL=1)
 * is present: resolveMessagesClientTransport throws and the top-level handler
 * below exits non-zero with the actionable error.
 */
function resolveStore(opts: CliOpts): { transport: "http" | "local"; local?: MessagesService; remote?: ReturnType<typeof createMessagesClient> } {
  const env = cliEnv(opts);
  const report = resolveMessagesClientTransport(env);
  if (report.transport === "http") {
    return { transport: "http", remote: createMessagesClient(env) };
  }
  return { transport: "local", local: new MessagesService(new SqliteMessagesStore()) };
}

/**
 * The uniform API/transport report (hasna/apps#1588). It is a pure read of the
 * resolved configuration: it constructs no store and opens no database, so it
 * is safe to print even when the CLI is unconfigured — which it reports as
 * `unconfigured` rather than by silently implying a local store.
 */
interface MessagesApiStatus {
  app: "messages";
  version: string;
  transport: "http" | "local" | "unconfigured";
  /** The resolved `/v1` authority, e.g. https://api.hasna.com/messages/v1. */
  api_url: string | null;
  /** The base URL exactly as configured, before `/v1` resolution. */
  api_base: string | null;
  api_key_present: boolean;
}

function apiStatus(opts: CliOpts): MessagesApiStatus {
  const env = cliEnv(opts);
  const rawBase = env[MESSAGES_API_URL_ENV]?.trim() || null;
  const apiKeyPresent = isPresent(env, MESSAGES_API_KEY_ENV);
  if (rawBase) {
    return {
      app: "messages",
      version,
      transport: "http",
      api_url: resolveMessagesApiBase(rawBase).apiUrl,
      api_base: rawBase,
      api_key_present: apiKeyPresent,
    };
  }
  return {
    app: "messages",
    version,
    transport: isLocalModeOptIn(env) ? "local" : "unconfigured",
    api_url: null,
    api_base: null,
    api_key_present: apiKeyPresent,
  };
}

/**
 * Accept `--json` on a data command. Every messages command already prints
 * JSON, so the flag is a no-op — but scripts pass it on any list/read/whoami
 * surface and commander rejects unknown options (hasna/apps#1602).
 */
function withJsonFlag(cmd: Command): Command {
  return cmd.option("--json", "Output as JSON (already the only output format)");
}

const program = new Command();

program
  .name("messages")
  .description("Direct agent-to-agent messaging with threads (DMs + DM-threads)")
  .version(version);

// --- identity --------------------------------------------------------------

withJsonFlag(program.command("register"))
  .description("Register (or return) an agent identity")
  .option("--name <agent>", `agent name ${AGENT_DEFAULT_HINT}`)
  .option("--display-name <text>", "human/seat-friendly label")
  .option("--url <url>", "messages-serve base URL (overrides HASNA_MESSAGES_API_URL; local mode requires HASNA_MESSAGES_LOCAL=1)")
  .option("--api-key <key>", "API key for the remote server")
  .action(async (opts: { name?: string; displayName?: string } & CliOpts) => {
    const store = resolveStore(opts);
    if (store.transport === "http") {
      print(await store.remote!.registerAgent(requireAgent(opts.name, "--name"), opts.displayName));
      return;
    }
    print({ agent: await store.local!.registerAgent(requireAgent(opts.name, "--name"), opts.displayName) });
  });

withJsonFlag(program.command("agents"))
  .description("List registered agent identities")
  .option("--url <url>", "messages-serve base URL (overrides HASNA_MESSAGES_API_URL; local mode requires HASNA_MESSAGES_LOCAL=1)")
  .option("--api-key <key>", "API key for the remote server")
  .action(async (opts: CliOpts) => {
    const store = resolveStore(opts);
    const agents = store.transport === "http" ? (await store.remote!.listAgents()).agents : await store.local!.listAgents();
    print(agents);
  });

withJsonFlag(program.command("whoami"))
  .description("Show an agent identity (or register it if absent)")
  .option("--agent <agent>", `agent name ${AGENT_DEFAULT_HINT}`)
  .option("--url <url>", "messages-serve base URL (overrides HASNA_MESSAGES_API_URL; local mode requires HASNA_MESSAGES_LOCAL=1)")
  .option("--api-key <key>", "API key for the remote server")
  .action(async (opts: { agent?: string } & CliOpts) => {
    const store = resolveStore(opts);
    const agent = store.transport === "http"
      ? (await store.remote!.registerAgent(requireAgent(opts.agent))).agent
      : await store.local!.registerAgent(requireAgent(opts.agent));
    // The identity record is spread at the top level so existing scripts that
    // read `.name` keep working; `api_url` and `transport` are the uniform
    // fleet fields required by hasna/apps#1588.
    const status = apiStatus(opts);
    print({ ...agent, transport: status.transport, api_url: status.api_url });
  });

// --- messaging -------------------------------------------------------------

withJsonFlag(program.command("send"))
  .description("Send a direct message from one agent to another (per-recipient delivery state 'stored')")
  .option("--from <agent>", `sending agent ${AGENT_DEFAULT_HINT}`)
  .requiredOption("--to <agent>", "receiving agent")
  .requiredOption("--content <text>", "message body")
  .option("--reply-to <id>", "message id being replied to (threads)")
  .option("--url <url>", "messages-serve base URL (overrides HASNA_MESSAGES_API_URL; local mode requires HASNA_MESSAGES_LOCAL=1)")
  .option("--api-key <key>", "API key for the remote server")
  .action(async (opts: { from?: string; to: string; content: string; replyTo?: string } & CliOpts) => {
    const store = resolveStore(opts);
    const result = store.transport === "http"
      ? await store.remote!.send(requireAgent(opts.from, "--from"), opts.to, opts.content, opts.replyTo)
      : await store.local!.send({ from_agent: requireAgent(opts.from, "--from"), to_agent: opts.to, content: opts.content, reply_to: opts.replyTo ?? null });
    print(result);
  });

withJsonFlag(program.command("receive"))
  .description("Drain the agent's inbox: transition stored -> delivered and print the delivered messages")
  .option("--agent <agent>", `the agent receiving ${AGENT_DEFAULT_HINT}`)
  .option("--url <url>", "messages-serve base URL (overrides HASNA_MESSAGES_API_URL; local mode requires HASNA_MESSAGES_LOCAL=1)")
  .option("--api-key <key>", "API key for the remote server")
  .action(async (opts: { agent?: string } & CliOpts) => {
    const store = resolveStore(opts);
    const messages = store.transport === "http"
      ? (await store.remote!.receive(requireAgent(opts.agent))).messages
      : await store.local!.receive(requireAgent(opts.agent));
    print(messages);
  });

withJsonFlag(program.command("delivery"))
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

withJsonFlag(program.command("threads"))
  .description("List threads involving an agent, with unread counts")
  .option("--agent <agent>", `the agent whose threads to list ${AGENT_DEFAULT_HINT}`)
  .option("--all", "include threads the agent has closed")
  .option("--url <url>", "messages-serve base URL (overrides HASNA_MESSAGES_API_URL; local mode requires HASNA_MESSAGES_LOCAL=1)")
  .option("--api-key <key>", "API key for the remote server")
  .action(async (opts: { agent?: string; all?: boolean } & CliOpts) => {
    const store = resolveStore(opts);
    const threads = store.transport === "http"
      ? (await store.remote!.threads(requireAgent(opts.agent), !opts.all)).threads
      : await store.local!.threads(requireAgent(opts.agent), { openOnly: !opts.all });
    print(threads);
  });

withJsonFlag(program.command("thread"))
  .description("Expand a thread: its messages with your per-message delivery state (does NOT mark read)")
  .requiredOption("--id <threadId>", "thread id")
  .option("--agent <agent>", `the agent expanding ${AGENT_DEFAULT_HINT}`)
  .option("--url <url>", "messages-serve base URL (overrides HASNA_MESSAGES_API_URL; local mode requires HASNA_MESSAGES_LOCAL=1)")
  .option("--api-key <key>", "API key for the remote server")
  .action(async (opts: { id: string; agent?: string } & CliOpts) => {
    const store = resolveStore(opts);
    const result = store.transport === "http"
      ? await store.remote!.thread(opts.id, requireAgent(opts.agent))
      : await store.local!.expandThread(opts.id, requireAgent(opts.agent));
    print(result);
  });

withJsonFlag(program.command("unread"))
  .description("List threads with unread messages for an agent (and the total)")
  .option("--agent <agent>", `the agent ${AGENT_DEFAULT_HINT}`)
  .option("--url <url>", "messages-serve base URL (overrides HASNA_MESSAGES_API_URL; local mode requires HASNA_MESSAGES_LOCAL=1)")
  .option("--api-key <key>", "API key for the remote server")
  .action(async (opts: { agent?: string } & CliOpts) => {
    const store = resolveStore(opts);
    if (store.transport === "http") {
      print(await store.remote!.unread(requireAgent(opts.agent)));
      return;
    }
    const threads = await store.local!.unreadThreads(requireAgent(opts.agent));
    print({ threads, total: threads.reduce((sum, t) => sum + t.unread_count, 0) });
  });

withJsonFlag(program.command("read"))
  .description("Mark a thread read from an agent's perspective (stored/delivered -> read)")
  .requiredOption("--id <threadId>", "thread id")
  .option("--agent <agent>", `the agent marking it read ${AGENT_DEFAULT_HINT}`)
  .option("--url <url>", "messages-serve base URL (overrides HASNA_MESSAGES_API_URL; local mode requires HASNA_MESSAGES_LOCAL=1)")
  .option("--api-key <key>", "API key for the remote server")
  .action(async (opts: { id: string; agent?: string } & CliOpts) => {
    const store = resolveStore(opts);
    if (store.transport === "http") {
      await store.remote!.markRead(opts.id, requireAgent(opts.agent));
    } else {
      await store.local!.markRead(opts.id, requireAgent(opts.agent));
    }
    print({ ok: true, thread_id: opts.id, agent: requireAgent(opts.agent) });
  });

withJsonFlag(program.command("close"))
  .description("Close a thread from an agent's perspective (excluded from the default list)")
  .requiredOption("--id <threadId>", "thread id")
  .option("--agent <agent>", `the agent closing it ${AGENT_DEFAULT_HINT}`)
  .option("--url <url>", "messages-serve base URL (overrides HASNA_MESSAGES_API_URL; local mode requires HASNA_MESSAGES_LOCAL=1)")
  .option("--api-key <key>", "API key for the remote server")
  .action(async (opts: { id: string; agent?: string } & CliOpts) => {
    const store = resolveStore(opts);
    const thread = store.transport === "http"
      ? (await store.remote!.closeThread(opts.id, requireAgent(opts.agent))).thread
      : await store.local!.closeThread(opts.id, requireAgent(opts.agent));
    print({ ok: true, thread });
  });

withJsonFlag(program.command("reopen"))
  .description("Reopen a thread from an agent's perspective")
  .requiredOption("--id <threadId>", "thread id")
  .option("--agent <agent>", `the agent reopening it ${AGENT_DEFAULT_HINT}`)
  .option("--url <url>", "messages-serve base URL (overrides HASNA_MESSAGES_API_URL; local mode requires HASNA_MESSAGES_LOCAL=1)")
  .option("--api-key <key>", "API key for the remote server")
  .action(async (opts: { id: string; agent?: string } & CliOpts) => {
    const store = resolveStore(opts);
    const thread = store.transport === "http"
      ? (await store.remote!.reopenThread(opts.id, requireAgent(opts.agent))).thread
      : await store.local!.reopenThread(opts.id, requireAgent(opts.agent));
    print({ ok: true, thread });
  });

// --- diagnostics -----------------------------------------------------------

withJsonFlag(program.command("status"))
  .description("Show the resolved API authority, transport and key presence")
  .option("--url <url>", "messages-serve base URL (overrides HASNA_MESSAGES_API_URL; local mode requires HASNA_MESSAGES_LOCAL=1)")
  .option("--api-key <key>", "API key for the remote server")
  .action((opts: { json?: boolean } & CliOpts) => {
    const status = apiStatus(opts);
    if (opts.json) {
      print(status);
    } else {
      // The `API:` line is the fleet-uniform format from hasna/apps#1588: the
      // resolved /v1 authority, never a bare origin and never the raw base.
      console.log(`messages ${status.version}`);
      console.log(`API: ${status.api_url ?? "(none)"}`);
      console.log(`transport: ${status.transport}`);
      console.log(`api key: ${status.api_key_present ? "present" : "absent"}`);
    }
    if (status.transport === "unconfigured") {
      console.error(
        `${MESSAGES_API_URL_ENV} is not set and ${MESSAGES_LOCAL_MODE_ENV}=1 was not given; ` +
          "no transport is configured.",
      );
      process.exit(1);
    }
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
