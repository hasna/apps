#!/usr/bin/env bun
/**
 * messages — the CLI surface of @hasna/messages.
 *
 * Interface layer over MessagesService (single domain implementation).
 * Local mode uses a SQLite store; --url/--api-key targets a running
 * messages-serve instance through the SDK client.
 */
import { Command } from "commander";
import { resolveCredential } from "@hasna/contracts/client";
import { MessagesService } from "../service";
import { SqliteMessagesStore } from "../server/sqlite-store";
import { MessagesClient } from "../sdk";
import { version } from "../version";

function localService(): MessagesService {
  return new MessagesService(new SqliteMessagesStore());
}

function remoteClient(opts: { url?: string; apiKey?: string }): MessagesClient | null {
  const url = opts.url ?? process.env.HASNA_MESSAGES_API_URL;
  if (!url) return null;
  // Credential via the @hasna/contracts client seam — never a bare env read.
  const resolved = resolveCredential("messages", process.env as NodeJS.ProcessEnv, { apiKey: opts.apiKey });
  return new MessagesClient({ baseUrl: url, apiKey: resolved?.apiKey });
}

const program = new Command();

program
  .name("messages")
  .description("Direct agent-to-agent messaging with threads")
  .version(version);

program
  .command("send")
  .description("Send a direct message from one agent to another")
  .requiredOption("--from <agent>", "sending agent")
  .requiredOption("--to <agent>", "receiving agent")
  .requiredOption("--content <text>", "message body")
  .option("--reply-to <id>", "message id being replied to (threads)")
  .option("--url <url>", "messages-serve base URL (default: local SQLite store)")
  .option("--api-key <key>", "API key for the remote server")
  .action(async (opts: { from: string; to: string; content: string; replyTo?: string; url?: string; apiKey?: string }) => {
    const client = remoteClient(opts);
    if (client) {
      const result = await client.send(opts.from, opts.to, opts.content, opts.replyTo);
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    const result = await localService().send({
      from_agent: opts.from,
      to_agent: opts.to,
      content: opts.content,
      reply_to: opts.replyTo ?? null,
    });
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("threads")
  .description("List threads involving an agent, with unread counts")
  .requiredOption("--agent <agent>", "the agent whose threads to list")
  .option("--url <url>", "messages-serve base URL (default: local SQLite store)")
  .option("--api-key <key>", "API key for the remote server")
  .action(async (opts: { agent: string; url?: string; apiKey?: string }) => {
    const client = remoteClient(opts);
    const threads = client
      ? await client.threads(opts.agent)
      : await localService().threads(opts.agent);
    console.log(JSON.stringify(threads, null, 2));
  });

program
  .command("read")
  .description("Read a thread's messages and mark it read from your side")
  .requiredOption("--thread <id>", "thread id")
  .requiredOption("--agent <agent>", "the agent reading")
  .option("--limit <n>", "message count limit", "100")
  .option("--url <url>", "messages-serve base URL (default: local SQLite store)")
  .option("--api-key <key>", "API key for the remote server")
  .action(async (opts: { thread: string; agent: string; limit: string; url?: string; apiKey?: string }) => {
    const client = remoteClient(opts);
    const messages = client
      ? await client.threadMessages(opts.thread, Number(opts.limit))
      : await localService().threadMessages(opts.thread, Number(opts.limit));
    if (!client) await localService().markRead(opts.thread, opts.agent);
    console.log(JSON.stringify(messages, null, 2));
  });

program
  .command("serve")
  .description("Start the messages-serve HTTP API")
  .action(async () => {
    const { serve } = await import("../server/serve-entry");
    await serve();
  });

await program.parseAsync(process.argv);
