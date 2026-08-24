import type { Command } from "commander";
import chalk from "chalk";
import { getStore } from "../../lib/store/index.js";
import { closeDb } from "../../lib/db.js";
import { resolveIdentity } from "../../lib/identity.js";
import { emitCliError } from "../cli-error.js";
import { printJson, printJsonLine, printLine } from "../../lib/stdout.js";
import { normalizeChannelName } from "../../lib/channel-names.js";
import { parseMessageReference, resolveMessageReference } from "../../lib/message-reference.js";
import type { ThreadExpandResult, ThreadSummary } from "../../types.js";

/**
 * Thread collection verbs (task bf381fad). A thread is a ROOT message plus
 * every descendant reply (reply_to chains may nest). Numeric root references
 * on the WRITE verbs (close/reopen) require an independent scope
 * (--channel/--session) exactly like `reply`; reads (expand) resolve a numeric
 * id directly the way `show` does.
 */
export function registerThreadCommands(program: Command): void {
  const threads = program
    .command("threads")
    .description("Thread collection: list, expand, close and reopen reply threads");

  threads
    .command("list")
    .description("List thread roots in a channel with reply count, last activity, status and per-agent unread")
    .option("--channel <name>", "Channel name (required)")
    .option("--from <agent>", "Reader identity — enables the per-thread unread count")
    .option("--limit <n>", "Max threads to return", parseInt)
    .option("--offset <n>", "Skip first N threads", parseInt)
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const channel = typeof opts.channel === "string" && opts.channel.trim()
        ? normalizeChannelName(opts.channel.trim())
        : "";
      if (!channel) {
        emitCliError("--channel is required for `threads list`.", opts);
      }
      const store = getStore();
      if (!await store.getChannel(channel)) {
        emitCliError(`Channel #${channel} not found.`, opts);
      }
      const from = typeof opts.from === "string" && opts.from.trim() ? resolveIdentity(opts.from).trim() : undefined;
      const result = await store.listThreads({
        channel,
        from,
        limit: opts.limit,
        offset: opts.offset,
      });

      if (opts.json) {
        printJson({ channel, count: result.count, threads: result.threads });
      } else {
        if (result.threads.length === 0) {
          printLine(chalk.dim(`No threads in #${channel}.`));
        } else {
          for (const thread of result.threads) {
            const unread = thread.unread_count ? chalk.yellow(` · ${thread.unread_count} unread`) : "";
            const status = thread.thread_status === "closed" ? chalk.red("closed") : chalk.green("open");
            printLine(
              `#${thread.root.id} [${status}] ${thread.root.from_agent} · ${thread.reply_count} replies · last ${thread.last_activity_at}${unread}`,
            );
            printLine(chalk.dim(`  ${thread.root.preview}`));
          }
        }
      }
      closeDb();
    });

  threads
    .command("expand")
    .description("Expand a thread: the root message plus its full nested reply tree")
    .argument("<root>", "Thread root message ID or UUID (any thread member resolves to its root)")
    .option("--from <agent>", "Reader identity")
    .option("-j, --json", "Output as JSON")
    .action(async (rootArg, opts) => {
      const ref = parseMessageReference(rootArg);
      if (!ref) {
        emitCliError(`<root> must be a positive message id or UUID (got: ${String(rootArg)}).`, opts);
      }
      const store = getStore();
      const resolved = await resolveMessageReference(store, ref, {});
      if (!resolved) {
        emitCliError(`Message ${String(rootArg)} not found.`, opts);
      }
      const expanded = await store.getThreadExpand(resolved.id);

      if (opts.json) {
        printJson(expanded);
      } else {
        renderThreadExpand(expanded);
      }
      closeDb();
    });

  const registerStatusVerb = (name: "close" | "reopen", status: "closed" | "open"): void => {
    threads
      .command(name)
      .description(name === "close" ? "Close a thread (root with a reply chain)" : "Reopen a closed thread")
      .argument("<root>", "Thread root message ID or UUID")
      .option("--channel <name>", "Expected channel (required for a numeric root)")
      .option("--session <id>", "Expected session (required for a numeric DM root)")
      .option("-j, --json", "Output as JSON")
      .action(async (rootArg, opts) => {
        const ref = parseMessageReference(rootArg);
        if (!ref) {
          emitCliError(`<root> must be a positive message id or UUID (got: ${String(rootArg)}).`, opts);
        }
        if (ref.kind === "id" && !opts.channel && !opts.session) {
          emitCliError(
            "Numeric thread roots require independent scope before a status change can be written. " +
              "Pass --channel <name> or --session <id>, or use the root UUID from threads list/expand output.",
            opts,
          );
        }
        const store = getStore();
        const scope = {
          channel: opts.channel ? normalizeChannelName(opts.channel) : undefined,
          session_id: opts.session,
        };
        const resolved = await resolveMessageReference(store, ref, scope);
        if (!resolved) {
          emitCliError(`Message ${String(rootArg)} not found.`, opts);
        }
        const updated = await store.setThreadStatus(resolved.id, status);
        if (opts.json) {
          printJsonLine({ thread_id: updated.id, thread_status: updated.thread_status ?? status });
        } else {
          printLine(chalk.green(`Thread #${updated.id} ${name === "close" ? "closed" : "reopened"}.`));
        }
        closeDb();
      });
  };
  registerStatusVerb("close", "closed");
  registerStatusVerb("reopen", "open");
}

function renderThreadExpand(expanded: ThreadExpandResult): void {
  const status = expanded.thread_status === "closed" ? chalk.red("closed") : chalk.green("open");
  printLine(`Thread root #${expanded.root.id} [${status}] ${expanded.root.from_agent} · ${expanded.reply_count} replies`);
  printLine(chalk.dim(`  ${expanded.root.content}`));
  for (const node of expanded.replies) {
    const indent = "  ".repeat(node.depth + 1);
    printLine(`${indent}#${node.message.id} ${node.message.from_agent}: ${node.message.content}`);
  }
}
