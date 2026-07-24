import type { Command } from "commander";
import { getStore } from "../../lib/store/index.js";
import chalk from "chalk";
import { normalizeSince } from "../../lib/since.js";
// Reads/writes route through getStore(): ApiStore (self_hosted/cloud) or LocalStore.
import { closeDb } from "../../lib/db.js";
import { resolveIdentity } from "../../lib/identity.js";
import { renderContent } from "../../lib/terminal-markdown.js";
import { buildMessagePreview } from "../../lib/channel-notifications.js";
import { previewText } from "../../lib/compact-output.js";
import { getCliWindow, pageFromQuery, printCompactFooter, queryLimitFor } from "../compact.js";
import { printMessageEntry } from "../message-output.js";
import { checkForUpdate } from "../../lib/version-check.js";
import type { DigestResult } from "../../lib/messages.js";

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
        console.error(chalk.red("Sender identity is required."));
        process.exit(1);
      }
      if (!to && !channel) {
        console.error(chalk.red("Recipient is required: use --to <agent> or --channel <name>."));
        process.exit(1);
      }
      if (!content.trim()) {
        console.error(chalk.red("Message content cannot be empty."));
        process.exit(1);
      }

      let metadata: Record<string, unknown> | undefined;
      if (opts.metadata) {
        try {
          metadata = JSON.parse(opts.metadata);
        } catch {
          console.error(chalk.red("Invalid --metadata JSON."));
          process.exit(1);
        }
      }

      const msg = await await getStore().sendMessage({
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

      if (opts.json) {
        console.log(JSON.stringify(msg, null, 2));
      } else if (channel) {
        console.log(chalk.green(`Message sent to #${channel}`) + chalk.dim(` (id: ${msg.id})`));
      } else {
        console.log(chalk.green(`Message sent`) + chalk.dim(` (id: ${msg.id}, session: ${msg.session_id})`));
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
    .option("--mark-read", "Mark returned messages as read")
    .option("--verbose", "Show full message bodies")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const window = getCliWindow({ limit: opts.limit, cursor: opts.cursor });
      const messages = await await getStore().readMessages({
        session_id: opts.session,
        from: opts.from,
        to: opts.to,
        channel: opts.channel,
        since: opts.since,
        limit: opts.json ? opts.limit : queryLimitFor(window),
        offset: opts.json ? opts.cursor : window.offset,
        unread_only: opts.unread,
      });
      const page = opts.json
        ? { items: messages, hasMore: false, nextCursor: null, count: messages.length }
        : pageFromQuery(messages, window);

      if (opts.markRead) {
        const reader = resolveIdentity(opts.to);
        const ids = page.items.filter((m) => !m.read_at).map((m) => m.id);
        if (ids.length > 0) await await getStore().markReadByIds(ids, reader);
      }

      if (opts.json) {
        console.log(JSON.stringify(messages, null, 2));
      } else {
        if (messages.length === 0) {
          console.log(chalk.dim("No messages found."));
        } else {
          for (const msg of page.items) printMessageEntry(msg, { verbose: opts.verbose });
          printCompactFooter({
            shown: page.count,
            hasMore: page.hasMore,
            nextCursor: page.nextCursor,
            limitCapped: window.limitCapped,
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
        console.error(chalk.red("Message ID must be a positive integer."));
        process.exit(1);
      }

      const msg = await await getStore().getMessageById(id);
      if (!msg) {
        console.error(chalk.red(`Message #${id} not found.`));
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(msg, null, 2));
      } else {
        const time = chalk.dim(msg.created_at.slice(0, 19).replace("T", " "));
        const destination = msg.channel ? chalk.magenta(`#${msg.channel}`) : chalk.yellow(msg.to_agent);
        const priority = msg.priority !== "normal" ? chalk.red(` [${msg.priority}]`) : "";
        const unread = !msg.read_at ? chalk.green(" [unread]") : "";
        console.log(`${chalk.cyan(msg.from_agent)} → ${destination}${priority}${unread} ${chalk.dim(`[#${msg.id}] ${time}`)}`);
        if (msg.attachments?.length) {
          console.log(chalk.dim(`Attachments: ${msg.attachments.map((att) => att.name).join(", ")}`));
        }
        console.log(renderContent(msg.content));
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
        console.error(chalk.red("Provide a channel name, --session <id>, or --to <agent>."));
        process.exit(1);
      }

      const reader = opts.markRead ? resolveIdentity(opts.from).trim() : undefined;
      if (opts.markRead && !reader) {
        console.error(chalk.red("Reader identity is required for --mark-read."));
        process.exit(1);
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
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(result));
      } else {
        const target = result.channel ? `#${result.channel}` : result.session_id ?? result.to ?? "messages";
        console.log(chalk.bold(`Digest ${result.digest_id} ${chalk.dim(`(${target})`)}`));
        console.log(chalk.dim(`shown ${result.shown}/${result.total_available}, bytes ${result.byte_length}/${result.max_bytes}, next_cursor ${result.next_cursor ?? "-"}`));
        if (result.messages.length === 0) {
          console.log(chalk.dim("  No messages in this digest window."));
        } else {
          for (const msg of result.messages) {
            const time = chalk.dim(msg.created_at.slice(11, 19));
            const from = chalk.cyan(msg.from);
            const dest = msg.channel ? chalk.magenta(`#${msg.channel}`) : chalk.yellow(msg.to ?? "?");
            const priority = msg.priority !== "normal" ? chalk.red(` [${msg.priority}]`) : "";
            const att = msg.has_attachments ? chalk.dim(" 📎") : "";
            const unread = msg.unread ? chalk.green(" unread") : "";
            console.log(`${time} ${from} → ${dest}${priority}${att}${unread} ${chalk.dim(`#${msg.id}`)}`);
            console.log(`  ${chalk.dim(msg.snippet)}`);
          }
          if (result.has_more) console.log(chalk.dim(`Continue with: ${formatDigestContinuationCommand(result)}`));
          console.log(chalk.dim("Use conversations show <id> for one full message."));
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
    .option("--limit <n>", "Max results to return", parseInt)
    .option("--cursor <n>", "Skip first N results for pagination", parseInt)
    .option("--verbose", "Show full message bodies")
    .option("-j, --json", "Output as JSON")
    .action(async (query, opts) => {
      const q = typeof query === "string" ? query.trim() : "";
      if (!q) {
        console.error(chalk.red("Search query cannot be empty."));
        process.exit(1);
      }
      const window = getCliWindow({ limit: opts.limit, cursor: opts.cursor });

      const messages = await await getStore().searchMessages({
        query: q,
        channel: opts.channel,
        from: opts.from,
        to: opts.to,
        limit: opts.json ? opts.limit : queryLimitFor(window),
        offset: opts.json ? opts.cursor : window.offset,
      });
      const page = opts.json
        ? { items: messages, count: messages.length, total: messages.length, hasMore: false, nextCursor: null }
        : pageFromQuery(messages, window);

      if (opts.json) {
        console.log(JSON.stringify(messages, null, 2));
      } else {
        if (messages.length === 0) {
          console.log(chalk.dim("No messages found."));
        } else {
          console.log(chalk.dim(`Search results for "${q}":\n`));
          for (const msg of page.items) printMessageEntry(msg, { verbose: opts.verbose });
          printCompactFooter({
            shown: page.count,
            hasMore: page.hasMore,
            nextCursor: page.nextCursor,
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
        console.error(chalk.red(`Invalid duration "${duration}". Use format: 30m, 2h, 1d`));
        process.exit(1);
      }
      const value = parseInt(match[1]);
      const unit = match[2] as "m" | "h" | "d";
      const msMap = { m: 60_000, h: 3_600_000, d: 86_400_000 };
      const since = new Date(Date.now() - value * msMap[unit]).toISOString().replace("T", "T").slice(0, 23);
      const window = getCliWindow({ limit: opts.limit, cursor: opts.cursor });

      const messages = await await getStore().readMessages({
        since,
        order: "asc",
        limit: opts.json ? (opts.limit ?? 200) : queryLimitFor(window),
        offset: opts.json ? opts.cursor : window.offset,
      });
      const page = opts.json
        ? { items: messages, count: messages.length, hasMore: false, nextCursor: null }
        : pageFromQuery(messages, window);

      if (opts.json) {
        console.log(JSON.stringify(messages, null, 2));
      } else {
        if (messages.length === 0) {
          console.log(chalk.dim(`No activity in the last ${duration}.`));
        } else {
          console.log(chalk.bold(`Activity since ${duration} ago\n`));
          for (const msg of page.items) printMessageEntry(msg, { verbose: opts.verbose });
          printCompactFooter({
            shown: page.count,
            hasMore: page.hasMore,
            nextCursor: page.nextCursor,
            limitCapped: window.limitCapped,
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
      const original = await await getStore().getMessageById(opts.to);
      if (!original) {
        console.error(chalk.red(`Message #${opts.to} not found.`));
        process.exit(1);
      }

      const from = resolveIdentity(opts.from).trim();
      const content = typeof message === "string" ? message : "";
      if (!from) {
        console.error(chalk.red("Sender identity is required."));
        process.exit(1);
      }
      if (!content.trim()) {
        console.error(chalk.red("Reply content cannot be empty."));
        process.exit(1);
      }
      const channel =
        original.channel ||
        (original.session_id?.startsWith("channel:") ? original.session_id.slice(6) : undefined);
      const to = channel
        ? channel
        : (original.from_agent === from ? original.to_agent : original.from_agent);
      const msg = await await getStore().sendMessage({
        from,
        to,
        content,
        session_id: original.session_id,
        priority: opts.priority,
        channel,
      });

      if (opts.json) {
        console.log(JSON.stringify(msg, null, 2));
      } else {
        console.log(chalk.green(`Reply sent`) + chalk.dim(` (id: ${msg.id}, session: ${msg.session_id})`));
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
        console.error(chalk.red("Provide message IDs, --all, --session, or --channel flag."));
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify({ marked_read: count }));
      } else {
        console.log(chalk.green(`Marked ${count} message(s) as read.`));
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
      console.log(result);
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
        console.error(chalk.red("Agent identity is required."));
        process.exit(1);
      }
      if (!content.trim()) {
        console.error(chalk.red("New content cannot be empty."));
        process.exit(1);
      }

      const msg = await await getStore().editMessage(id, agent, content);

      if (opts.json) {
        console.log(JSON.stringify(msg, null, 2));
      } else {
        if (msg) {
          console.log(chalk.green(`Message #${id} edited.`));
        } else {
          console.error(chalk.red(`Message #${id} not found or not your message.`));
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
        console.error(chalk.red("Agent identity is required."));
        process.exit(1);
      }

      const result = await await getStore().deleteMessage(id, agent);

      if (opts.json) {
        console.log(JSON.stringify({ id, deleted: result }));
      } else {
        if (result) {
          console.log(chalk.green(`Message #${id} deleted.`));
        } else {
          console.error(chalk.red(`Message #${id} not found or not your message.`));
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
        console.log(JSON.stringify(msg, null, 2));
      } else {
        if (msg) {
          console.log(chalk.green(`Message #${id} pinned.`));
        } else {
          console.error(chalk.red(`Message #${id} not found.`));
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
        console.log(JSON.stringify(msg, null, 2));
      } else {
        if (msg) {
          console.log(chalk.green(`Message #${id} unpinned.`));
        } else {
          console.error(chalk.red(`Message #${id} not found.`));
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
        console.log(JSON.stringify(messages, null, 2));
      } else {
        if (messages.length === 0) {
          console.log(chalk.dim("No pinned messages."));
        } else {
          console.log(chalk.dim("Pinned messages:\n"));
          for (const msg of page.items) printMessageEntry(msg, { verbose: opts.verbose });
          printCompactFooter({
            shown: page.count,
            hasMore: page.hasMore,
            nextCursor: page.nextCursor,
            limitCapped: window.limitCapped,
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
        console.log(JSON.stringify(blockers, null, 2));
      } else {
        if (blockers.length === 0) {
          console.log(chalk.dim("No blocking messages."));
        } else {
          console.log(chalk.red.bold("Blocking messages:\n"));
          for (const b of page.items) printMessageEntry(b, { verbose: opts.verbose, destination: b.channel ? chalk.magenta(`#${b.channel}`) : chalk.yellow("DM") });
          console.log(chalk.dim(`Acknowledge shown blockers with: conversations mark-read ${page.items.map(b => b.id).join(" ")}`));
          printCompactFooter({
            shown: page.count,
            hasMore: page.hasMore,
            nextCursor: page.nextCursor,
            limitCapped: window.limitCapped,
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
          console.log(JSON.stringify({ cleared, agent, channel: opts.channel || null }, null, 2));
        } else {
          console.log(chalk.green(`Cleared ${cleared} notification(s).`));
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
        console.log(JSON.stringify(notifications, null, 2));
      } else if (notifications.length === 0) {
        console.log(chalk.dim("No channel notifications."));
      } else {
        for (const item of notifications) {
          const time = chalk.dim(item.created_at.slice(11, 19));
          const priority = item.priority !== "normal" ? chalk.red(` [${item.priority}]`) : "";
          const unread = item.unread ? chalk.yellow(" [unread]") : "";
          console.log(`${time} ${chalk.cyan(item.from_agent)} ${chalk.magenta(`#${item.channel}`)}${priority}${unread} ${chalk.dim(`msg #${item.message_id}`)}`);
          console.log(`  ${item.preview}`);
        }
        console.log(chalk.dim("\nInspect the full message later with: conversations show <message-id>"));
      }
      closeDb();
    });

  program
    .command("watch")
    .description("Watch for new messages with desktop notifications")
    .option("--from <agent>", "Your agent identity")
    .option("--channel <name>", "Watch a specific channel")
    .option("--all", "Watch DMs and all subscribed channels")
    .option("--interval <ms>", "Poll interval in milliseconds", parseInt)
    .option("--verbose", "Show full message bodies")
    .action(async (opts) => {
      const agent = resolveIdentity(opts.from);
      await getStore().heartbeat(agent);

      const interval = Number.isFinite(opts.interval) && opts.interval > 0 ? opts.interval : 1000;
      const cols = Math.min(process.stdout.columns || 80, 100);

      // Resolve the agent's subscribed channels when --all is used
      let agentChannels: string[] = [];
      if (opts.all) {
        agentChannels = (await getStore().listChannelNotificationSubscriptions(agent)).map((row) => row.channel);
      }

      const modeLabel = opts.all
        ? `DMs + ${agentChannels.length} channel(s)`
        : opts.channel ? `Channel: #${opts.channel}` : "All DMs";

      console.log("");
      console.log(chalk.bold(`  Conversations`) + chalk.dim(` — watching as ${chalk.cyan(agent)}`));
      console.log(chalk.dim(`  ${modeLabel} · Poll: ${interval}ms · Ctrl+C to stop`));
      console.log(chalk.dim("  " + "─".repeat(cols - 4)));
      console.log("");

      const { startPolling } = require("../../lib/poll.js");
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
        console.log(`  ${sender}  ${where}  ${time}${priority}${blocking}`);

        // Content with indent
        const content = opts.verbose
          ? renderContentLocal(msg.content) as string
          : previewText(msg.content);
        const indented = content.split("\n").map((l: string) => "    " + l).join("\n");
        console.log(indented);
        if (!opts.verbose) {
          console.log(chalk.dim(`    Inspect with: conversations show ${msg.id}`));
        }

        // Separator
        console.log(chalk.dim("    " + "·".repeat(Math.min(cols - 8, 60))));
        console.log("");
      };

      const renderNotification = (notification: import("../../types.js").ChannelNotification) => {
        const time = chalk.dim(notification.created_at.slice(11, 19));
        const priority = notification.priority !== "normal"
          ? (notification.priority === "urgent" ? chalk.red.bold(` [${notification.priority}]`) :
             notification.priority === "high" ? chalk.yellow(` [${notification.priority}]`) :
             chalk.dim(` [${notification.priority}]`))
          : "";
        const sender = chalk.cyan.bold(notification.from_agent);

        console.log(`  ${sender}  ${chalk.magenta(`#${notification.channel}`)}  ${time}${priority} ${chalk.dim(`[#${notification.message_id}]`)}`);
        console.log(`    ${notification.preview}`);
        console.log(chalk.dim(`    Preview only. Inspect with: conversations show ${notification.message_id}`));
        console.log(chalk.dim("    " + "·".repeat(Math.min(cols - 8, 60))));
        console.log("");
      };

      // Show recent messages first
      if (opts.all) {
        const dmRecent = await await getStore().readMessages({ to: agent, limit: 20, order: "asc" });
        const pendingNotifications = (await getStore().readChannelNotifications({
          agent,
          unread_only: true,
          limit: 20,
          mark_read: true,
        })).sort((left, right) => left.created_at.localeCompare(right.created_at) || left.message_id - right.message_id);

        if (dmRecent.length > 0) {
          console.log(chalk.dim(`  ── Recent DMs (${dmRecent.length}) ──\n`));
          for (const msg of dmRecent) { renderMessage(msg); }
        }
        if (pendingNotifications.length > 0) {
          console.log(chalk.dim(`  ── Pending channel notifications (${pendingNotifications.length}) ──\n`));
          for (const notification of pendingNotifications) { renderNotification(notification); }
        }
        if (dmRecent.length > 0 || pendingNotifications.length > 0) {
          console.log(chalk.dim(`  ── Live ──\n`));
        }
      } else {
        const recent = await await getStore().readMessages({
          to: opts.channel ? undefined : agent,
          channel: opts.channel,
          limit: 20,
          order: "asc",
        });
        if (recent.length > 0) {
          console.log(chalk.dim(`  ── Recent messages (${recent.length}) ──\n`));
          for (const msg of recent) { renderMessage(msg); }
          console.log(chalk.dim(`  ── Live ──\n`));
        }
      }

      const onNewMessages = (messages: import("../../types.js").Message[]) => {
        for (const msg of messages) {
          if (msg.from_agent === agent) continue;
          renderMessage(msg);

          // Desktop notification (short preview)
          const where = msg.channel ? `#${msg.channel}` : "DM";
          const preview = buildMessagePreview(msg.content, 150);
          desktopNotify(`${msg.from_agent} (${where})`, preview);
        }
      };

      const onNewNotifications = (notifications: import("../../types.js").ChannelNotification[]) => {
        for (const notification of notifications) {
          renderNotification(notification);
          desktopNotify(`${notification.from_agent} (#${notification.channel})`, notification.preview);
        }
      };

      const stops: Array<{ stop: () => void }> = [];

      if (opts.all) {
        stops.push(startPolling({ to_agent: agent, interval_ms: interval, on_messages: onNewMessages }));

        let inFlightNotifications = false;
        const timer = setInterval(async () => {
          if (inFlightNotifications) return;
          inFlightNotifications = true;
          try {
            const notifications = (await getStore().readChannelNotifications({
              agent,
              unread_only: true,
              limit: 200,
              mark_read: true,
            })).sort((left, right) => left.created_at.localeCompare(right.created_at) || left.message_id - right.message_id);

            if (notifications.length > 0) {
              onNewNotifications(notifications);
            }
          } finally {
            inFlightNotifications = false;
          }
        }, interval);
        stops.push({ stop: () => clearInterval(timer) });
      } else {
        stops.push(startPolling({
          to_agent: opts.channel ? undefined : agent,
          channel: opts.channel,
          interval_ms: interval,
          on_messages: onNewMessages,
        }));
      }

      process.on("SIGINT", () => {
        for (const stop of stops) stop.stop();
        console.log(chalk.dim("\n  Stopped watching."));
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
          console.log(JSON.stringify({ error: "Failed to check npm registry" }));
        } else {
          console.error(chalk.red("Failed to check npm registry for updates."));
        }
        process.exit(1);
      }

      const { current, latest, updateAvailable } = info;

      if (opts.check || !updateAvailable) {
        if (opts.json) {
          console.log(JSON.stringify({ current, latest, updateAvailable }));
        } else if (updateAvailable) {
          console.log(`Current version: ${chalk.yellow(current)}`);
          console.log(`Latest version:  ${chalk.green(latest)}`);
          console.log(chalk.cyan(`Run ${chalk.bold("conversations update")} to install.`));
        } else {
          console.log(chalk.green(`Already on latest version (${current})`));
        }
        return;
      }

      // Install update
      if (opts.json) {
        console.log(JSON.stringify({ current, latest, updateAvailable, status: "updating" }));
      } else {
        console.log(`Updating from ${chalk.yellow(current)} to ${chalk.green(latest)}...`);
      }

      const proc = Bun.spawn(["bun", "install", "-g", `@hasna/conversations@${latest}`], {
        stdout: "inherit",
        stderr: "inherit",
      });
      const exitCode = await proc.exited;

      if (exitCode === 0) {
        if (!opts.json) {
          console.log(chalk.green(`\nSuccessfully updated to v${latest}`));
        }
      } else {
        if (opts.json) {
          console.log(JSON.stringify({ error: "Update failed", exitCode }));
        } else {
          console.error(chalk.red(`\nUpdate failed (exit code ${exitCode})`));
        }
        process.exit(1);
      }
    });
}
