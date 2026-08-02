import type { Command } from "commander";
import { getStore } from "../../lib/store/index.js";
import chalk from "chalk";
import { normalizeSince } from "../../lib/since.js";
// Reads/writes route through getStore(): ApiStore (self_hosted/cloud) or LocalStore.
import { closeDb } from "../../lib/db.js";
import { resolveIdentities, resolveIdentity } from "../../lib/identity.js";
import { renderContent } from "../../lib/terminal-markdown.js";
import { buildMessagePreview } from "../../lib/channel-notifications.js";
import { readChannelNotificationsUnion } from "../../lib/poll-notifications.js";
import { resolveSelfSenderId } from "../../lib/sender-identity.js";
import { previewText } from "../../lib/compact-output.js";
import { getCliWindow, pageFromQuery, printCompactFooter, printJsonDisclosure, queryLimitFor, warnIfPageFull, SINCE_JSON_LIMIT } from "../compact.js";
import { BLOCKERS_LIST_ORDER, PINNED_LIST_ORDER } from "../../lib/list-order.js";
import { printMessageEntry } from "../message-output.js";
import { resolveReadWindow } from "../../lib/message-window.js";
import { checkForUpdate } from "../../lib/version-check.js";
import { emitCliError } from "../cli-error.js";
import { warnIfRedacted } from "../redaction-notice.js";
import type { DigestResult } from "../../lib/messages.js";
import { printErrorLine, printJson, printJsonLine, printLine } from "../../lib/stdout.js";

function quoteDigestCommandArg(value: string): string {
  return /^[A-Za-z0-9._:/@=-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
}

export function formatDigestContinuationCommand(result: Pick<DigestResult, "channel" | "session_id" | "to" | "next_cursor" | "max_bytes">): string {
  const parts = ["conversations", "digest"];
  if (result.channel) {
    parts.push(quoteDigestCommandArg(result.channel));
  } else if (result.session_id) {
    parts.push("--session", quoteDigestCommandArg(result.session_id));
  } else if (result.to) {
    parts.push("--to", quoteDigestCommandArg(result.to));
  }
  parts.push("--cursor", String(result.next_cursor), "--max-bytes", String(result.max_bytes));
  return parts.join(" ");
}

function failCommand(error: unknown, fallback: string): never {
  printErrorLine(chalk.red(error instanceof Error ? error.message : fallback));
  closeDb();
  process.exit(1);
}

export function registerMessagingCommands(program: Command): void {
  // ---- send ----
  program
    .command("send")
    .description("Send a message to an agent")
    .argument("<message>", "Message content")
    .option("--to <agent>", "Recipient agent ID (required unless --channel is used)")
    .option("--from <agent>", "Sender agent ID")
    .option("--session <id>", "Session ID (auto-generated if omitted)")
    .option("--priority <level>", "Priority: low, normal, high, urgent", "normal")
    .option("--working-dir <path>", "Working directory context")
    .option("--repository <repo>", "Repository context")
    .option("--branch <branch>", "Branch context")
    .option("--metadata <json>", "JSON metadata string")
    .option("--channel <name>", "Send to a channel instead of a specific agent")
    .option("--blocking", "Send as a blocking message (recipient must acknowledge)")
    .option("-j, --json", "Output as JSON")
    .action(async (message, opts) => {
      const from = resolveIdentity(opts.from).trim();
      const to = typeof opts.to === "string" ? opts.to.trim() : "";
      const channel = typeof opts.channel === "string" ? opts.channel.trim() : "";
      const content = typeof message === "string" ? message : "";
      const session = typeof opts.session === "string" && opts.session.trim()
        ? opts.session.trim()
        : undefined;

      if (!from) {
        emitCliError("Sender identity is required.", opts);
      }
      if (!to && !channel) {
        emitCliError("Recipient is required: use --to <agent> or --channel <name>.", opts);
      }
      if (!content.trim()) {
        emitCliError("Message content cannot be empty.", opts);
      }

      let metadata: Record<string, unknown> | undefined;
      if (opts.metadata) {
        try {
          metadata = JSON.parse(opts.metadata);
        } catch {
          emitCliError("Invalid --metadata JSON.", opts);
        }
      }

      let msg;
      try {
        msg = await getStore().sendMessage({
          from,
          to: to || from,
          channel: channel || undefined,
          content,
          session_id: session,
          priority: opts.priority,
          working_dir: opts.workingDir,
          repository: opts.repository,
          branch: opts.branch,
          metadata,
          blocking: opts.blocking,
        });
      } catch (error) {
        return failCommand(error, "Failed to send message.");
      }

      const redaction = warnIfRedacted(content, msg.content);

      if (opts.json) {
        printJson({ ...msg, redaction });
      } else if (channel) {
        printLine(chalk.green(`Message sent to #${channel}`) + chalk.dim(` (id: ${msg.id})`));
      } else {
        printLine(chalk.green(`Message sent`) + chalk.dim(` (id: ${msg.id}, session: ${msg.session_id})`));
      }
      closeDb();
    });

  // ---- read ----
  program
    .command("read")
    .description("Read messages")
    .option("--session <id>", "Filter by session ID")
    .option("--from <agent>", "Filter by sender")
    .option("--to <agent>", "Filter by recipient")
    .option("--channel <name>", "Filter by channel")
    .option("--since <timestamp>", "Messages after this ISO timestamp")
    .option("--limit <n>", "Max messages to return", parseInt)
    .option("--cursor <n>", "Skip first N messages for pagination", parseInt)
    .option("--unread", "Only unread messages")
    .option("--unread-only", "Only unread messages")
    .option("--mark-read", "Mark returned messages as read")
    .option("--verbose", "Show full message bodies")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const window = getCliWindow({ limit: opts.limit, cursor: opts.cursor });
      const query = {
        session_id: opts.session,
        from: opts.from,
        to: opts.to,
        channel: opts.channel,
        since: opts.since,
        limit: opts.json ? opts.limit : queryLimitFor(window),
        offset: opts.json ? opts.cursor : window.offset,
        unread_only: opts.unread || opts.unreadOnly,
      };
      const messages = await getStore().readMessages(query);
      const page = opts.json
        ? { items: messages, hasMore: false, nextCursor: null, count: messages.length }
        : pageFromQuery(messages, window, { newestWindow: resolveReadWindow(query).newestWindow });

      if (opts.markRead) {
        const reader = resolveIdentity(opts.to);
        const ids = page.items.filter((m) => !m.read_at).map((m) => m.id);
        if (ids.length > 0) await await getStore().markReadByIds(ids, reader);
      }

      if (opts.json) {
        printJson(messages);
        warnIfPageFull(messages.length, query.limit);
      } else {
        if (messages.length === 0) {
          printLine(chalk.dim("No messages found."));
        } else {
          for (const msg of page.items) printMessageEntry(msg, { verbose: opts.verbose });
          printCompactFooter({
            shown: page.count,
            hasMore: page.hasMore,
            nextCursor: page.nextCursor,
            limitCapped: window.limitCapped,
            sort: getStore().describeListOrder("messages"),
            detailHint: opts.verbose ? "Use conversations show <id> for one message." : "Use --verbose for full bodies or conversations show <id> for one message.",
          });
        }
      }
      closeDb();
    });

  // ---- show ----
  program
    .command("show")
    .description("Show a full message by ID")
    .argument("<id>", "Numeric message ID")
    .option("-j, --json", "Output as JSON")
    .action(async (idArg, opts) => {
      const id = Number.parseInt(String(idArg), 10);
      if (!Number.isFinite(id) || id <= 0) {
        emitCliError("Message ID must be a positive integer.", opts);
      }

      const msg = await await getStore().getMessageById(id);
      if (!msg) {
        emitCliError(`Message #${id} not found.`, opts);
      }

      if (opts.json) {
        printJson(msg);
      } else {
        const time = chalk.dim(msg.created_at.slice(0, 19).replace("T", " "));
        const destination = msg.channel ? chalk.magenta(`#${msg.channel}`) : chalk.yellow(msg.to_agent);
        const priority = msg.priority !== "normal" ? chalk.red(` [${msg.priority}]`) : "";
        const unread = !msg.read_at ? chalk.green(" [unread]") : "";
        printLine(`${chalk.cyan(msg.from_agent)} → ${destination}${priority}${unread} ${chalk.dim(`[#${msg.id}] ${time}`)}`);
        if (msg.attachments?.length) {
          printLine(chalk.dim(`Attachments: ${msg.attachments.map((att) => att.name).join(", ")}`));
        }
        printLine(renderContent(msg.content));
      }
      closeDb();
    });

  // ---- digest ----
  program
    .command("digest")
    .description("Show a cursored byte-capped channel digest")
    .argument("[channel]", "Channel name to digest")
    .option("--since <timestamp>", "Messages after this ISO timestamp")
    .option("--cursor <message-id>", "Only include messages after this message ID", parseInt)
    .option("--max-bytes <n>", "Maximum JSON payload size", parseInt)
    .option("--limit <n>", "Max messages to show", parseInt)
    .option("--session <id>", "Digest a DM/session instead of a channel")
    .option("--to <agent>", "Filter by recipient (for DMs)")
    .option("--unread", "Only include unread messages")
    .option("--mark-read", "Mark returned messages read after building the digest")
    .option("--from <agent>", "Reader identity for --mark-read")
    .option("-j, --json", "Output as JSON")
    .action(async (channelArg, opts) => {
      const channel = typeof channelArg === "string" && channelArg.trim() ? channelArg.trim() : undefined;
      if (!channel && !opts.session && !opts.to) {
        emitCliError("Provide a channel name, --session <id>, or --to <agent>.", opts);
      }

      const reader = opts.markRead ? resolveIdentity(opts.from).trim() : undefined;
      if (opts.markRead && !reader) {
        emitCliError("Reader identity is required for --mark-read.", opts);
      }

      let result;
      try {
        result = await await getStore().readDigest({
          channel,
          session_id: opts.session,
          since: opts.since,
          cursor: opts.cursor,
          max_bytes: opts.maxBytes,
          limit: opts.limit,
          to: opts.to,
          unread_only: opts.unread,
          mark_read: opts.markRead,
          reader,
        });
      } catch (error) {
        emitCliError(error instanceof Error ? error.message : String(error), opts);
      }

      if (opts.json) {
        printJsonLine(result);
      } else {
        const target = result.channel ? `#${result.channel}` : result.session_id ?? result.to ?? "messages";
        printLine(chalk.bold(`Digest ${result.digest_id} ${chalk.dim(`(${target})`)}`));
        printLine(chalk.dim(`shown ${result.shown}/${result.total_available}, bytes ${result.byte_length}/${result.max_bytes}, next_cursor ${result.next_cursor ?? "-"}`));
        if (result.messages.length === 0) {
          printLine(chalk.dim("  No messages in this digest window."));
        } else {
          for (const msg of result.messages) {
            const time = chalk.dim(msg.created_at.slice(11, 19));
            const from = chalk.cyan(msg.from);
            const dest = msg.channel ? chalk.magenta(`#${msg.channel}`) : chalk.yellow(msg.to ?? "?");
            const priority = msg.priority !== "normal" ? chalk.red(` [${msg.priority}]`) : "";
            const att = msg.has_attachments ? chalk.dim(" 📎") : "";
            const unread = msg.unread ? chalk.green(" unread") : "";
            printLine(`${time} ${from} → ${dest}${priority}${att}${unread} ${chalk.dim(`#${msg.id}`)}`);
            printLine(`  ${chalk.dim(msg.snippet)}`);
          }
          if (result.has_more) printLine(chalk.dim(`Continue with: ${formatDigestContinuationCommand(result)}`));
          printLine(chalk.dim("Use conversations show <id> for one full message."));
        }
      }
      closeDb();
    });

  // ---- search ----
  program
    .command("search")
    .description("Search messages by content")
    .argument("<query>", "Search query string")
    .option("--channel <name>", "Filter by channel")
    .option("--from <agent>", "Filter by sender")
    .option("--to <agent>", "Filter by recipient")
    .option("--limit <n>", "Max results to return (the server caps a single page at 500)", parseInt)
    .option("--cursor <n>", "Skip first N results for pagination", parseInt)
    .option("--verbose", "Show full message bodies")
    .option("-j, --json", "Output as JSON")
    .addHelpText("after", `
Two limits bound what this verb can tell you. Both are silent by default, and
both bite hardest on the thing search is most used for — auditing a sender or a
channel, which is an ABSENCE claim.

  1. PAGE SIZE. A single page is capped at 500 rows server-side; --limit above
     that is clamped, not honoured. The cap is now always disclosed: text output
     prints "More available: rerun with --cursor N", and --json prints the same
     line to stderr while stdout stays a bare array. Page with --cursor until
     the notice stops. Never read a 500-row result as a population.

  2. THE QUERY IS A CONTENT FILTER, NOT A SENDER LISTING. search returns
     messages MATCHING THE QUERY, filtered by --from — not "this sender's
     messages". Any message that does not contain the query term is invisible,
     and the misses are not scattered: they cluster BY TEMPLATE. A term that
     correlates with how a message is written will silently exclude that whole
     class of message.

     Measured by agent-chief-marketing (#incidents 648598) against 19 message
     ids they held independently: a signature-term search found 17 of 19, and
     both misses were [REPORT] posts, whose template carries no signature. The
     500-row cap was tested and ruled out as the cause — both missing ids fell
     inside the returned id range. A caller sampling those results sees nothing
     wrong, because the absent rows are systematically alike and absent
     together.

     To enumerate a sender exhaustively, page a listing verb; do not infer a
     population from a content search.`)
    .action(async (query, opts) => {
      const q = typeof query === "string" ? query.trim() : "";
      if (!q) {
        emitCliError("Search query cannot be empty.", opts);
      }
      const window = getCliWindow({ limit: opts.limit, cursor: opts.cursor });

      // The store pages this verb now. `--json` used to pass the raw limit and
      // then hardcode `hasMore: false`, so a result cut short by the backend's
      // 500-row cap was published as a complete set (todos 83852845).
      const result = await getStore().searchMessagesPage({
        query: q,
        channel: opts.channel,
        from: opts.from,
        to: opts.to,
        limit: opts.json ? opts.limit : window.limit,
        offset: opts.json ? opts.cursor : window.offset,
      });
      const disclosure = {
        shown: result.items.length,
        hasMore: result.has_more,
        nextCursor: result.next_cursor,
        sort: getStore().describeListOrder("search"),
      };

      if (opts.json) {
        printJson(result.items);
        // stdout stays a bare array — every monitor on this fleet parses it as
        // one — so the truncation notice goes to stderr alongside it.
        printJsonDisclosure(disclosure);
      } else {
        if (result.items.length === 0) {
          printLine(chalk.dim("No messages found."));
        } else {
          printLine(chalk.dim(`Search results for "${q}":\n`));
          for (const msg of result.items) printMessageEntry(msg, { verbose: opts.verbose });
          printCompactFooter({
            ...disclosure,
            limitCapped: window.limitCapped,
            detailHint: opts.verbose ? "Use conversations show <id> for one message." : "Use --verbose for full bodies or conversations show <id> for one message.",
          });
        }
      }
      closeDb();
    });

  // ---- since ----
  program
    .command("since")
    .description("Show all activity (DMs + channels) since a duration ago")
    .argument("<duration>", "Duration: e.g. 30m, 2h, 1d")
    .option("--limit <n>", "Max messages to show", parseInt)
    .option("--cursor <n>", "Skip first N messages for pagination", parseInt)
    .option("--verbose", "Show full message bodies")
    .option("-j, --json", "Output as JSON")
    .action(async (duration, opts) => {
      // Parse duration string: 30m, 2h, 1d
      const match = duration.match(/^(\d+)([mhd])$/);
      if (!match) {
        emitCliError(`Invalid duration "${duration}". Use format: 30m, 2h, 1d`, opts);
      }
      const value = parseInt(match[1]);
      const unit = match[2] as "m" | "h" | "d";
      const msMap = { m: 60_000, h: 3_600_000, d: 86_400_000 };
      const since = new Date(Date.now() - value * msMap[unit]).toISOString().replace("T", "T").slice(0, 23);
      const window = getCliWindow({ limit: opts.limit, cursor: opts.cursor });

      // `order: "asc"` used to be hardcoded here. The store-layer recency fix
      // could not reach it — an explicit order is honoured by design — so this
      // command stayed blind to the newest messages after both stores were
      // fixed, and `--limit` could not rescue it because the server clamps a
      // /messages read at 500 rows (todos 2c25973b). Ordering is now the
      // resolver's decision, so `since` answers with the NEWEST N of the window.
      const query = {
        since,
        limit: opts.json ? (opts.limit ?? SINCE_JSON_LIMIT) : queryLimitFor(window),
        offset: opts.json ? opts.cursor : window.offset,
      };
      const messages = await getStore().readMessages(query);
      const page = opts.json
        ? { items: messages, count: messages.length, hasMore: false, nextCursor: null }
        : pageFromQuery(messages, window, { newestWindow: resolveReadWindow(query).newestWindow });

      if (opts.json) {
        printJson(messages);
        warnIfPageFull(messages.length, query.limit);
      } else {
        if (messages.length === 0) {
          printLine(chalk.dim(`No activity in the last ${duration}.`));
        } else {
          printLine(chalk.bold(`Activity since ${duration} ago\n`));
          for (const msg of page.items) printMessageEntry(msg, { verbose: opts.verbose });
          printCompactFooter({
            shown: page.count,
            hasMore: page.hasMore,
            nextCursor: page.nextCursor,
            limitCapped: window.limitCapped,
            sort: getStore().describeListOrder("messages", { order: "asc" }),
            detailHint: opts.verbose ? "Use conversations show <id> for one message." : "Use --verbose for full bodies or conversations show <id> for one message.",
          });
        }
      }
      closeDb();
    });

  // ---- reply ----
  program
    .command("reply")
    .description("Reply to a message (uses same session)")
    .argument("<message>", "Reply content")
    .requiredOption("--to <message-id>", "Message ID to reply to", parseInt)
    .option("--from <agent>", "Sender agent ID")
    .option("--priority <level>", "Priority: low, normal, high, urgent", "normal")
    .option("-j, --json", "Output as JSON")
    .action(async (message, opts) => {
      // `parseInt` yields NaN for `--to not-a-number`; catch it here so the
      // failure names the bad input instead of surfacing as "not found".
      const parentId = opts.to;
      if (!Number.isInteger(parentId) || parentId <= 0) {
        emitCliError(`--to must be a positive message id (got: ${String(opts.to)}).`, opts);
      }
      const original = await await getStore().getMessageById(parentId);
      if (!original) {
        emitCliError(`Message #${parentId} not found.`, opts);
      }

      const from = resolveIdentity(opts.from).trim();
      const content = typeof message === "string" ? message : "";
      if (!from) {
        emitCliError("Sender identity is required.", opts);
      }
      if (!content.trim()) {
        emitCliError("Reply content cannot be empty.", opts);
      }
      const channel =
        original.channel ||
        (original.session_id?.startsWith("channel:") ? original.session_id.slice(6) : undefined);
      const to = channel
        ? channel
        : (original.from_agent === from ? original.to_agent : original.from_agent);
      let msg;
      try {
        msg = await getStore().sendMessage({
          from,
          to,
          content,
          session_id: original.session_id,
          priority: opts.priority,
          // The whole point of `reply`: persist the parent link. Omitting this
          // stored every reply with reply_to NULL while still printing "Reply
          // sent", so threads could not be reconstructed from the data at all.
          reply_to: parentId,
          channel,
        });
      } catch (error) {
        return failCommand(error, "Failed to send reply.");
      }

      // Fail closed on a write that did not thread. The success line is what
      // concealed the original defect, so confirm the stored row actually
      // carries the parent before claiming the reply was sent. This also
      // catches a server image too old to persist reply_to, which would
      // otherwise silently degrade the reply to a top-level post.
      if (msg.reply_to !== parentId) {
        emitCliError(
          `Reply was stored as message #${msg.id} but its parent link did not persist ` +
            `(expected reply_to=${parentId}, stored ${JSON.stringify(msg.reply_to)}). ` +
            `The message is NOT threaded — check that the conversations server supports reply_to.`,
          opts,
          { id: msg.id, expected_reply_to: parentId, stored_reply_to: msg.reply_to ?? null },
        );
      }

      const redaction = warnIfRedacted(content, msg.content);

      if (opts.json) {
        printJson({ ...msg, redaction });
      } else {
        printLine(chalk.green(`Reply sent`) + chalk.dim(` (id: ${msg.id}, session: ${msg.session_id})`));
      }
      closeDb();
    });

  // ---- mark-read ----
  program
    .command("mark-read")
    .description("Mark messages as read")
    .argument("[ids...]", "Message IDs to mark as read")
    .option("--all", "Mark all messages as read")
    .option("--session <id>", "Mark all messages in session as read")
    .option("--channel <name>", "Mark all messages in channel as read")
    .option("--agent <id>", "Agent marking messages as read")
    .option("-j, --json", "Output as JSON")
    .action(async (ids, opts) => {
      const agent = resolveIdentity(opts.agent);
      let count = 0;

      if (opts.all) {
        count = await await getStore().markAllRead(agent);
      } else if (opts.session) {
        count = await await getStore().markSessionRead(opts.session, agent);
      } else if (opts.channel) {
        count = await await getStore().markChannelRead(opts.channel, agent);
      } else if (ids.length > 0) {
        count = await await getStore().markRead(ids.map(Number), agent);
      } else {
        emitCliError("Provide message IDs, --all, --session, or --channel flag.", opts);
      }

      if (opts.json) {
        printJsonLine({ marked_read: count });
      } else {
        printLine(chalk.green(`Marked ${count} message(s) as read.`));
      }
      closeDb();
    });

  // ---- export ----
  program
    .command("export")
    .description("Export messages as JSON or CSV")
    .option("--channel <name>", "Filter by channel")
    .option("--session <id>", "Filter by session ID")
    .option("--from <agent>", "Filter by sender")
    .option("--since <date>", "Messages after this ISO date")
    .option("--until <date>", "Messages before this ISO date")
    .option("--format <format>", "Output format: json or csv", "json")
    .action(async (opts) => {
      const format = opts.format === "csv" ? "csv" : "json";
      const result = await getStore().exportMessages({
        channel: opts.channel,
        session_id: opts.session,
        from: opts.from,
        since: normalizeSince(opts.since),
        until: opts.until,
        format,
      });
      printLine(result);
      closeDb();
    });

  // ---- edit ----
  program
    .command("edit")
    .description("Edit a message (only sender can edit)")
    .argument("<id>", "Message ID", parseInt)
    .argument("<new-content>", "New message content")
    .option("--from <agent>", "Sender agent ID")
    .option("-j, --json", "Output as JSON")
    .action(async (id, newContent, opts) => {
      const agent = resolveIdentity(opts.from).trim();
      const content = typeof newContent === "string" ? newContent : "";
      if (!agent) {
        emitCliError("Agent identity is required.", opts);
      }
      if (!content.trim()) {
        emitCliError("New content cannot be empty.", opts);
      }

      let msg;
      try {
        msg = await getStore().editMessage(id, agent, content);
      } catch (error) {
        return failCommand(error, "Failed to edit message.");
      }

      // An edit persists a body exactly like a send does, so it can be rewritten
      // exactly like a send — and "Message #N edited." was just as silent about it.
      const redaction = msg ? warnIfRedacted(content, msg.content) : undefined;

      if (opts.json) {
        printJson(msg ? { ...msg, redaction } : msg);
      } else {
        if (msg) {
          printLine(chalk.green(`Message #${id} edited.`));
        } else {
          printErrorLine(chalk.red(`Message #${id} not found or not your message.`));
          process.exit(1);
        }
      }
      closeDb();
    });

  // ---- delete ----
  program
    .command("delete")
    .description("Delete a message (only sender can delete)")
    .argument("<id>", "Message ID", parseInt)
    .option("--from <agent>", "Sender agent ID")
    .option("-j, --json", "Output as JSON")
    .action(async (id, opts) => {
      const agent = resolveIdentity(opts.from).trim();
      if (!agent) {
        emitCliError("Agent identity is required.", opts);
      }

      const result = await await getStore().deleteMessage(id, agent);

      if (opts.json) {
        printJsonLine({ id, deleted: result });
      } else {
        if (result) {
          printLine(chalk.green(`Message #${id} deleted.`));
        } else {
          printErrorLine(chalk.red(`Message #${id} not found or not your message.`));
          process.exit(1);
        }
      }
      closeDb();
    });

  // ---- pin ----
  program
    .command("pin")
    .description("Pin a message")
    .argument("<id>", "Message ID", parseInt)
    .option("-j, --json", "Output as JSON")
    .action(async (id, opts) => {
      const msg = await await getStore().pinMessage(id);

      if (opts.json) {
        printJson(msg);
      } else {
        if (msg) {
          printLine(chalk.green(`Message #${id} pinned.`));
        } else {
          printErrorLine(chalk.red(`Message #${id} not found.`));
          process.exit(1);
        }
      }
      closeDb();
    });

  // ---- unpin ----
  program
    .command("unpin")
    .description("Unpin a message")
    .argument("<id>", "Message ID", parseInt)
    .option("-j, --json", "Output as JSON")
    .action(async (id, opts) => {
      const msg = await await getStore().unpinMessage(id);

      if (opts.json) {
        printJson(msg);
      } else {
        if (msg) {
          printLine(chalk.green(`Message #${id} unpinned.`));
        } else {
          printErrorLine(chalk.red(`Message #${id} not found.`));
          process.exit(1);
        }
      }
      closeDb();
    });

  // ---- pinned ----
  program
    .command("pinned")
    .description("List pinned messages")
    .option("--channel <name>", "Filter by channel")
    .option("--session <id>", "Filter by session ID")
    .option("--limit <n>", "Max results", parseInt)
    .option("--cursor <n>", "Skip first N results for pagination", parseInt)
    .option("--verbose", "Show full message bodies")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const window = getCliWindow({ limit: opts.limit, cursor: opts.cursor });
      const messages = await await getStore().getPinnedMessages({
        channel: opts.channel,
        session_id: opts.session,
        limit: opts.json ? opts.limit : queryLimitFor(window),
        offset: opts.json ? opts.cursor : window.offset,
      });
      const page = opts.json
        ? { items: messages, count: messages.length, total: messages.length, hasMore: false, nextCursor: null }
        : pageFromQuery(messages, window);
      if (opts.json) {
        printJson(messages);
      } else {
        if (messages.length === 0) {
          printLine(chalk.dim("No pinned messages."));
        } else {
          printLine(chalk.dim("Pinned messages:\n"));
          for (const msg of page.items) printMessageEntry(msg, { verbose: opts.verbose });
          printCompactFooter({
            shown: page.count,
            hasMore: page.hasMore,
            nextCursor: page.nextCursor,
            limitCapped: window.limitCapped,
            sort: PINNED_LIST_ORDER,
            detailHint: opts.verbose ? "Use conversations show <id> for one message." : "Use --verbose for full bodies or conversations show <id> for one message.",
          });
        }
      }
      closeDb();
    });

  // ---- blockers ----
  program
    .command("blockers")
    .description("Check for unread blocking messages")
    .option("--from <agent>", "Agent to check blockers for")
    .option("--limit <n>", "Max blockers to show", parseInt)
    .option("--cursor <n>", "Skip first N blockers for pagination", parseInt)
    .option("--verbose", "Show full message bodies")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const agent = resolveIdentity(opts.from);
      const window = getCliWindow({ limit: opts.limit, cursor: opts.cursor });
      const blockers = await getStore().getUnreadBlockers(agent, opts.json ? undefined : { limit: queryLimitFor(window), offset: window.offset });
      const page = opts.json
        ? { items: blockers, count: blockers.length, total: blockers.length, hasMore: false, nextCursor: null }
        : pageFromQuery(blockers, window);

      if (opts.json) {
        printJson(blockers);
      } else {
        if (blockers.length === 0) {
          printLine(chalk.dim("No blocking messages."));
        } else {
          printLine(chalk.red.bold("Blocking messages:\n"));
          for (const b of page.items) printMessageEntry(b, { verbose: opts.verbose, destination: b.channel ? chalk.magenta(`#${b.channel}`) : chalk.yellow("DM") });
          printLine(chalk.dim(`Acknowledge shown blockers with: conversations mark-read ${page.items.map(b => b.id).join(" ")}`));
          printCompactFooter({
            shown: page.count,
            hasMore: page.hasMore,
            nextCursor: page.nextCursor,
            limitCapped: window.limitCapped,
            sort: BLOCKERS_LIST_ORDER,
            detailHint: opts.verbose ? "Use conversations show <id> for one blocker." : "Use --verbose for full bodies or conversations show <id> for one blocker.",
          });
        }
      }
      closeDb();
    });

  // ---- watch ----
  program
    .command("notifications")
    .description("List preview-only notifications from subscribed channels")
    .option("--from <agent>", "Your agent identity")
    .option("--channel <name>", "Filter to a single channel")
    .option("--since <timestamp>", "Notifications after this ISO timestamp")
    .option("--limit <n>", "Max notifications to return", parseInt)
    .option("--all", "Include already-read notifications")
    .option("--mark-read", "Mark returned notifications as read")
    .option("--clear", "Mark all matching unread notifications as read without listing")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const agent = resolveIdentity(opts.from);
      await getStore().heartbeat(agent);

      if (opts.clear) {
        const cleared = await getStore().markAllChannelNotificationsRead(agent, opts.channel);
        if (opts.json) {
          printJson({ cleared, agent, channel: opts.channel || null });
        } else {
          printLine(chalk.green(`Cleared ${cleared} notification(s).`));
        }
        closeDb();
        return;
      }

      const notifications = await getStore().readChannelNotifications({
        agent,
        channel: opts.channel,
        since: normalizeSince(opts.since),
        unread_only: !opts.all,
        limit: opts.limit,
        mark_read: opts.markRead,
      });

      if (opts.json) {
        printJson(notifications);
      } else if (notifications.length === 0) {
        printLine(chalk.dim("No channel notifications."));
      } else {
        for (const item of notifications) {
          const time = chalk.dim(item.created_at.slice(11, 19));
          const priority = item.priority !== "normal" ? chalk.red(` [${item.priority}]`) : "";
          const unread = item.unread ? chalk.yellow(" [unread]") : "";
          printLine(`${time} ${chalk.cyan(item.from_agent)} ${chalk.magenta(`#${item.channel}`)}${priority}${unread} ${chalk.dim(`msg #${item.message_id}`)}`);
          printLine(`  ${item.preview}`);
        }
        printLine(chalk.dim("\nInspect the full message later with: conversations show <message-id>"));
      }
      closeDb();
    });

  program
    .command("watch")
    .description("Watch for new messages with desktop notifications")
    .option("--from <agent>", "Your agent identity; comma-separated for several (reads union, first is primary for writes)")
    .option("--channel <name>", "Watch a specific channel")
    .option("--all", "Watch DMs and all subscribed channels")
    .option("--interval <ms>", "Poll interval in milliseconds", parseInt)
    .option("--verbose", "Show full message bodies")
    .option("--full-content", "Render full channel message bodies instead of the stripped preview")
    .action(async (opts) => {
      // A seat answers to more than one name and the queues are disjoint. Reads
      // union across every identity; identities[0] is primary and is the ONLY
      // one this command writes under (heartbeat, and the read-marking that
      // each queue does for itself).
      const identities = resolveIdentities(opts.from);
      const agent = identities[0];
      const store = getStore();
      await store.heartbeat(agent);
      const selfSenderIds = new Set<string>();
      for (const identity of identities) {
        selfSenderIds.add(identity);
        selfSenderIds.add(resolveSelfSenderId(identity, await store.getPresence(identity)));
      }
      const isSelf = (from: string) => selfSenderIds.has(from);

      const interval = Number.isFinite(opts.interval) && opts.interval > 0 ? opts.interval : 1000;
      const cols = Math.min(process.stdout.columns || 80, 100);
      // `--verbose` is documented as "show full message bodies" and has only
      // ever applied to DMs; honouring it for channels too is that promise
      // being kept, not a new default. Absent both flags, nothing changes.
      const wantFullContent = !!(opts.fullContent || opts.verbose);

      // Resolve subscribed channels across every identity when --all is used
      let agentChannels: string[] = [];
      if (opts.all) {
        const channels = new Set<string>();
        for (const identity of identities) {
          for (const row of await store.listChannelNotificationSubscriptions(identity)) {
            channels.add(row.channel);
          }
        }
        agentChannels = [...channels];
      }

      const modeLabel = opts.all
        ? `DMs + ${agentChannels.length} channel(s)`
        : opts.channel ? `Channel: #${opts.channel}` : "All DMs";
      const identityLabel = identities.length > 1
        ? `${chalk.cyan(agent)}${chalk.dim(` (+${identities.length - 1}: ${identities.slice(1).join(", ")})`)}`
        : chalk.cyan(agent);

      printLine("");
      printLine(chalk.bold(`  Conversations`) + chalk.dim(` — watching as ${identityLabel}`));
      printLine(chalk.dim(`  ${modeLabel} · Poll: ${interval}ms · Ctrl+C to stop`));
      printLine(chalk.dim("  " + "─".repeat(cols - 4)));
      printLine("");

      const { startPolling } = require("../../lib/poll.js");
      const { startNotificationPolling } = require("../../lib/poll-notifications.js");
      const { renderContent: renderContentLocal } = require("../../lib/terminal-markdown.js");

      const desktopNotify = (title: string, body: string) => {
        if (process.platform === "darwin") {
          try {
            const { execSync } = require("child_process");
            const t = title.replace(/['"\\]/g, " ");
            const b = body.replace(/['"\\]/g, " ").replace(/\n/g, " ").slice(0, 200);
            execSync(`osascript -e 'display notification "${b}" with title "${t}"'`, { timeout: 3000 });
          } catch {}
        }
      };

      const renderMessage = (msg: import("../../types.js").Message) => {
        const time = chalk.dim(msg.created_at.slice(11, 19));
        const where = msg.channel
          ? chalk.magenta(`#${msg.channel}`)
          : chalk.yellow("DM");
        const priority = msg.priority !== "normal"
          ? (msg.priority === "urgent" ? chalk.red.bold(` [${msg.priority}]`) :
             msg.priority === "high" ? chalk.yellow(` [${msg.priority}]`) :
             chalk.dim(` [${msg.priority}]`))
          : "";
        const blocking = msg.blocking ? chalk.red.bold(" ⚠ BLOCKER") : "";
        const sender = chalk.cyan.bold(msg.from_agent);

        // Header line
        printLine(`  ${sender}  ${where}  ${time}${priority}${blocking}`);

        // Content with indent
        const content = opts.verbose
          ? renderContentLocal(msg.content) as string
          : previewText(msg.content);
        const indented = content.split("\n").map((l: string) => "    " + l).join("\n");
        printLine(indented);
        if (!opts.verbose) {
          printLine(chalk.dim(`    Inspect with: conversations show ${msg.id}`));
        }

        // Separator
        printLine(chalk.dim("    " + "·".repeat(Math.min(cols - 8, 60))));
        printLine("");
      };

      /** Message ids already rendered, so two identities cannot double-print. */
      const renderedNotifications = new Set<number>();

      const renderNotification = (notification: import("../../types.js").ChannelNotification) => {
        if (renderedNotifications.has(notification.message_id)) return;
        renderedNotifications.add(notification.message_id);

        const time = chalk.dim(notification.created_at.slice(11, 19));
        const priority = notification.priority !== "normal"
          ? (notification.priority === "urgent" ? chalk.red.bold(` [${notification.priority}]`) :
             notification.priority === "high" ? chalk.yellow(` [${notification.priority}]`) :
             chalk.dim(` [${notification.priority}]`))
          : "";
        const sender = chalk.cyan.bold(notification.from_agent);

        printLine(`  ${sender}  ${chalk.magenta(`#${notification.channel}`)}  ${time}${priority} ${chalk.dim(`[#${notification.message_id}]`)}`);

        // The preview strips `[*#`~_>-]`, so agent names, `repo#pr` refs and
        // branch names all arrive with their separators replaced by spaces.
        // With full content requested we print the body as stored.
        if (notification.content !== undefined) {
          const rendered = renderContentLocal(notification.content) as string;
          printLine(rendered.split("\n").map((l: string) => "    " + l).join("\n"));
        } else {
          printLine(`    ${notification.preview}`);
          printLine(chalk.dim(`    Preview only. Inspect with: conversations show ${notification.message_id}`));
        }
        printLine(chalk.dim("    " + "·".repeat(Math.min(cols - 8, 60))));
        printLine("");
      };

      // Show recent messages first
      if (opts.all) {
        const dmSeen = new Set<number>();
        const dmRecent: import("../../types.js").Message[] = [];
        for (const identity of identities) {
          for (const msg of await store.readMessages({ to: identity, limit: 20, order: "asc" })) {
            if (isSelf(msg.from_agent) || dmSeen.has(msg.id)) continue;
            dmSeen.add(msg.id);
            dmRecent.push(msg);
          }
        }
        dmRecent.sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id - right.id);

        const pendingBatch = await readChannelNotificationsUnion(store, {
          agents: identities,
          unread_only: true,
          limit: 20,
          mark_read: true,
          include_content: wantFullContent,
        });
        const pendingNotifications = pendingBatch.notifications;

        if (dmRecent.length > 0) {
          printLine(chalk.dim(`  ── Recent DMs (${dmRecent.length}) ──\n`));
          for (const msg of dmRecent) { renderMessage(msg); }
        }
        if (pendingNotifications.length > 0) {
          printLine(chalk.dim(`  ── Pending channel notifications (${pendingNotifications.length}) ──\n`));
          for (const notification of pendingNotifications) { renderNotification(notification); }
          await pendingBatch.markRead();
        }
        if (dmRecent.length > 0 || pendingNotifications.length > 0) {
          printLine(chalk.dim(`  ── Live ──\n`));
        }
      } else {
        const recentSeen = new Set<number>();
        const recent: import("../../types.js").Message[] = [];
        // A channel watch is one stream; only the DM watch is per-identity.
        const readTargets = opts.channel ? [undefined] : identities;
        for (const identity of readTargets) {
          for (const msg of await store.readMessages({
            to: identity,
            channel: opts.channel,
            limit: 20,
            order: "asc",
          })) {
            if (isSelf(msg.from_agent) || recentSeen.has(msg.id)) continue;
            recentSeen.add(msg.id);
            recent.push(msg);
          }
        }
        recent.sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id - right.id);
        if (recent.length > 0) {
          printLine(chalk.dim(`  ── Recent messages (${recent.length}) ──\n`));
          for (const msg of recent) { renderMessage(msg); }
          printLine(chalk.dim(`  ── Live ──\n`));
        }
      }

      /** Ids already rendered live, so overlapping identity polls print once. */
      const renderedMessages = new Set<number>();

      const onNewMessages = (messages: import("../../types.js").Message[]) => {
        for (const msg of messages) {
          if (isSelf(msg.from_agent)) continue;
          if (renderedMessages.has(msg.id)) continue;
          renderedMessages.add(msg.id);
          renderMessage(msg);

          // Desktop notification (short preview)
          const where = msg.channel ? `#${msg.channel}` : "DM";
          const preview = buildMessagePreview(msg.content, 150);
          desktopNotify(`${msg.from_agent} (${where})`, preview);
        }
      };

      const onNewNotifications = (notifications: import("../../types.js").ChannelNotification[]) => {
        for (const notification of notifications) {
          const fresh = !renderedNotifications.has(notification.message_id);
          renderNotification(notification);
          if (fresh) {
            desktopNotify(`${notification.from_agent} (#${notification.channel})`, notification.preview);
          }
        }
      };

      const stops: Array<{ stop: () => void }> = [];

      if (opts.all) {
        // One DM loop per identity: `to_agent` is a single-value filter, and a
        // seat's two queues are disjoint.
        for (const identity of identities) {
          stops.push(startPolling({ to_agent: identity, interval_ms: interval, on_messages: onNewMessages }));
        }

        stops.push(startNotificationPolling({
          store,
          agent,
          agents: identities,
          interval_ms: interval,
          include_content: wantFullContent,
          on_notifications: onNewNotifications,
        }));
      } else if (opts.channel) {
        stops.push(startPolling({
          channel: opts.channel,
          interval_ms: interval,
          on_messages: onNewMessages,
        }));
      } else {
        for (const identity of identities) {
          stops.push(startPolling({
            to_agent: identity,
            interval_ms: interval,
            on_messages: onNewMessages,
          }));
        }
      }

      process.on("SIGINT", () => {
        for (const stop of stops) stop.stop();
        printLine(chalk.dim("\n  Stopped watching."));
        closeDb();
        process.exit(0);
      });
    });

  // ---- update ----
  program
    .command("update")
    .description("Check for and install updates")
    .option("--check", "Only check for updates, don't install")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const info = await checkForUpdate();
      if (info.latest === null) {
        if (opts.json) {
          printJsonLine({ error: "Failed to check npm registry" });
        } else {
          printErrorLine(chalk.red("Failed to check npm registry for updates."));
        }
        process.exit(1);
      }

      const { current, latest, updateAvailable } = info;

      if (opts.check || !updateAvailable) {
        if (opts.json) {
          printJsonLine({ current, latest, updateAvailable });
        } else if (updateAvailable) {
          printLine(`Current version: ${chalk.yellow(current)}`);
          printLine(`Latest version:  ${chalk.green(latest)}`);
          printLine(chalk.cyan(`Run ${chalk.bold("conversations update")} to install.`));
        } else {
          printLine(chalk.green(`Already on latest version (${current})`));
        }
        return;
      }

      // Install update
      if (opts.json) {
        printJsonLine({ current, latest, updateAvailable, status: "updating" });
      } else {
        printLine(`Updating from ${chalk.yellow(current)} to ${chalk.green(latest)}...`);
      }

      const proc = Bun.spawn(["bun", "install", "-g", `@hasna/conversations@${latest}`], {
        stdout: "inherit",
        stderr: "inherit",
      });
      const exitCode = await proc.exited;

      if (exitCode === 0) {
        if (!opts.json) {
          printLine(chalk.green(`\nSuccessfully updated to v${latest}`));
        }
      } else {
        if (opts.json) {
          printJsonLine({ error: "Update failed", exitCode });
        } else {
          printErrorLine(chalk.red(`\nUpdate failed (exit code ${exitCode})`));
        }
        process.exit(1);
      }
    });
}
