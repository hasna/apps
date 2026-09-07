#!/usr/bin/env bun
/**
 * messages — the CLI surface of @hasna/messages.
 *
 * Interface layer over the single domain implementation. Local mode uses a
 * local SQLite store and is an EXPLICIT opt-in (HASNA_MESSAGES_LOCAL=1);
 * `--url` pins a messages-serve authority, and otherwise the shared
 * @hasna/contracts resolver (CLI, MCP server and ./sdk all call it, per
 * request, fresh — hasna/apps#1720) supplies the credential and the
 * authority, defaulting to the fleet gateway
 * https://api.hasna.com/messages once a credential resolves. Hosted with no
 * credential anywhere the CLI fails closed (non-zero exit, actionable error,
 * no SQLite file, no local fallback) — only the explicit opt-in reaches the
 * on-box store, and it says "local" on stderr. Agent identity is
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
  resolveMessagesClientTransport,
  type MessagesClientResolveOptions,
  type MessagesClientTransportReport,
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

/**
 * The resolver options for a CLI invocation: `--url` / `--api-key` are tier-1
 * arguments — the environment is handed to the resolver BY IDENTITY (never a
 * copy, #1788), with only the cli `--url` text used verbatim.
 */
function cliResolveOptions(opts: CliOpts): MessagesClientResolveOptions {
  return {
    ...(opts.url !== undefined ? { baseUrl: opts.url } : {}),
    ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
  };
}

/**
 * Resolve the client transport from CLI overrides + env, through the shared
 * @hasna/contracts resolver. Fails closed: hosted with no credential throws
 * and the top-level handler exits non-zero with the actionable error.
 */
function resolveStore(opts: CliOpts): { transport: "http" | "local"; local?: MessagesService; remote?: ReturnType<typeof createMessagesClient> } {
  const report = resolveMessagesClientTransport(process.env, cliResolveOptions(opts));
  if (report.transport === "http") {
    const client = createMessagesClient(process.env, {
      ...(opts.url !== undefined ? { baseUrl: opts.url } : {}),
      ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
    });
    if (!client) throw new Error("HTTP transport resolved but no client could be created");
    return { transport: "http", remote: client };
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
  /** The base URL exactly as configured (before `/v1` resolution), or null under the gateway default. */
  api_base: string | null;
  api_key_present: boolean;
  /** WHERE the authority came from: an env key NAME, a Keychain item reference, a file PATH, "default", or null. */
  api_url_source: string | null;
  /** WHERE the key came from, or null. Never a value. */
  api_key_source: string | null;
  api_key_tier: string | null;
  /** True when `--url` pinned the authority, so no ambient credential applies. */
  authority_pinned: boolean;
  /** Refusal detail when `transport` is `unconfigured`. */
  issues: string[];
}

function apiStatus(opts: CliOpts): MessagesApiStatus {
  const base = {
    app: "messages" as const,
    version,
    api_key_present: false,
    api_url_source: null as string | null,
    api_key_source: null as string | null,
    api_key_tier: null as string | null,
    authority_pinned: false,
    issues: [],
  };
  let report: MessagesClientTransportReport;
  try {
    report = resolveMessagesClientTransport(process.env, cliResolveOptions(opts));
  } catch (error) {
    return {
      ...base,
      transport: "unconfigured",
      api_url: null,
      api_base: null,
      issues: [error instanceof Error ? error.message : String(error)],
    };
  }
  if (report.transport === "local") {
    return {
      ...base,
      transport: "local",
      api_url: null,
      api_base: null,
    };
  }
  return {
    ...base,
    transport: "http",
    api_url: report.baseUrl,
    api_base: report.configuredApiBase,
    api_key_present: report.apiKeyPresent,
    api_url_source: report.apiUrlSource,
    api_key_source: report.apiKeySource,
    api_key_tier: report.apiKeyTier,
    authority_pinned: report.authorityPinned,
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
  .option("--url <url>", "messages-serve base URL (explicit authority pin; no ambient credential is attached without --api-key)")
  .option("--api-key <key>", "API key for the remote server (a deliberate pin; never re-resolved)")
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
  .option("--url <url>", "messages-serve base URL (explicit authority pin; no ambient credential is attached without --api-key)")
  .option("--api-key <key>", "API key for the remote server (a deliberate pin; never re-resolved)")
  .action(async (opts: CliOpts) => {
    const store = resolveStore(opts);
    const agents = store.transport === "http" ? (await store.remote!.listAgents()).agents : await store.local!.listAgents();
    print(agents);
  });

withJsonFlag(program.command("whoami"))
  .description("Show an agent identity (or register it if absent)")
  .option("--agent <agent>", `agent name ${AGENT_DEFAULT_HINT}`)
  .option("--url <url>", "messages-serve base URL (explicit authority pin; no ambient credential is attached without --api-key)")
  .option("--api-key <key>", "API key for the remote server (a deliberate pin; never re-resolved)")
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
  .option("--url <url>", "messages-serve base URL (explicit authority pin; no ambient credential is attached without --api-key)")
  .option("--api-key <key>", "API key for the remote server (a deliberate pin; never re-resolved)")
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
  .option("--url <url>", "messages-serve base URL (explicit authority pin; no ambient credential is attached without --api-key)")
  .option("--api-key <key>", "API key for the remote server (a deliberate pin; never re-resolved)")
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
  .option("--url <url>", "messages-serve base URL (explicit authority pin; no ambient credential is attached without --api-key)")
  .option("--api-key <key>", "API key for the remote server (a deliberate pin; never re-resolved)")
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
  .option("--url <url>", "messages-serve base URL (explicit authority pin; no ambient credential is attached without --api-key)")
  .option("--api-key <key>", "API key for the remote server (a deliberate pin; never re-resolved)")
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
  .option("--url <url>", "messages-serve base URL (explicit authority pin; no ambient credential is attached without --api-key)")
  .option("--api-key <key>", "API key for the remote server (a deliberate pin; never re-resolved)")
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
  .option("--url <url>", "messages-serve base URL (explicit authority pin; no ambient credential is attached without --api-key)")
  .option("--api-key <key>", "API key for the remote server (a deliberate pin; never re-resolved)")
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
  .option("--url <url>", "messages-serve base URL (explicit authority pin; no ambient credential is attached without --api-key)")
  .option("--api-key <key>", "API key for the remote server (a deliberate pin; never re-resolved)")
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
  .option("--url <url>", "messages-serve base URL (explicit authority pin; no ambient credential is attached without --api-key)")
  .option("--api-key <key>", "API key for the remote server (a deliberate pin; never re-resolved)")
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
  .option("--url <url>", "messages-serve base URL (explicit authority pin; no ambient credential is attached without --api-key)")
  .option("--api-key <key>", "API key for the remote server (a deliberate pin; never re-resolved)")
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
  .option("--url <url>", "messages-serve base URL (explicit authority pin; no ambient credential is attached without --api-key)")
  .option("--api-key <key>", "API key for the remote server (a deliberate pin; never re-resolved)")
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
      for (const issue of status.issues) console.error(issue);
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
