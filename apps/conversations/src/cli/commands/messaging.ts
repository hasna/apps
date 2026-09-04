import type { Command } from "commander";
import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import { getStore } from "../../lib/store/index.js";
import chalk from "chalk";
import { normalizeExactIsoTimestamp, normalizeSince } from "../../lib/since.js";
// Reads/writes route through getStore(): ApiStore (HTTP API) or LocalStore.
import { closeDb } from "../../lib/db.js";
import { resolveIdentities, resolveIdentity } from "../../lib/identity.js";
import { renderContent } from "../../lib/terminal-markdown.js";
import { buildMessagePreview } from "../../lib/channel-notifications.js";
import { resolveSelfSenderId } from "../../lib/sender-identity.js";
import { buildCompactSearchEnvelope, parseNonNegativeInteger, previewText } from "../../lib/compact-output.js";
import { getCliWindow, pageFromQuery, printCompactFooter, printJsonDisclosure, queryLimitFor, warnIfPageFull, SINCE_JSON_LIMIT } from "../compact.js";
import { BLOCKERS_LIST_ORDER, PINNED_LIST_ORDER } from "../../lib/list-order.js";
import { printMessageEntry, printReactionRow } from "../message-output.js";
import { resolveReadWindow } from "../../lib/message-window.js";
import { checkForUpdate } from "../../lib/version-check.js";
import { emitCliError } from "../cli-error.js";
import { warnIfRedacted } from "../redaction-notice.js";
import type { DigestResult } from "../../lib/messages.js";
import { printErrorLine, printJson, printJsonLine, printLine } from "../../lib/stdout.js";
import { normalizeChannelName } from "../../lib/channel-names.js";
import {
  messageChannel,
  parseMessageReference,
  resolveMessageReference,
} from "../../lib/message-reference.js";
import {
  discloseEmptyResult,
  FROM_ALIAS_HELP,
  noteSenderFilterAlias,
  resolveSenderFilter,
  SENDER_HELP,
} from "../sender-filter.js";

function quoteDigestCommandArg(value: string): string {
  return /^[A-Za-z0-9._:/@=-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
}

// Agent-addressed DMs were removed from conversations (staged behind the
// messages-app v1 release gate). The digest continuation command is
// channel-scoped only; the `session_id`/`to` fields of DigestResult remain in
// the store contract (shared with the channel path) and are not emitted here.
export function formatDigestContinuationCommand(result: Pick<DigestResult, "channel" | "session_id" | "to" | "next_cursor" | "max_bytes">): string {
  const parts = ["conversations", "digest"];
  if (result.channel) {
    parts.push(quoteDigestCommandArg(result.channel));
  }
  parts.push("--cursor", String(result.next_cursor), "--max-bytes", String(result.max_bytes));
  return parts.join(" ");
}

type DesktopNotificationRunner = (
  file: string,
  args: string[],
  options: { timeout: number },
) => unknown;

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function sendDesktopNotification(
  title: string,
  body: string,
  platform = process.platform,
  run: DesktopNotificationRunner = execFileSync as DesktopNotificationRunner,
): void {
  if (platform !== "darwin") return;

  try {
    const t = escapeAppleScriptString(title);
    const b = escapeAppleScriptString(body.replace(/\r?\n/g, " ").slice(0, 200));
    run("osascript", [`-e`, `display notification "${b}" with title "${t}"`], { timeout: 3000 });
  } catch {}
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
    // The positional order is CHANNEL first: when a second positional is
    // present the handler swaps so `send <channel> "<message>"` is the
    // documented form (see the swap branch below and
    // send-positional-channel.e2e.test.ts). Commander derives the usage line
    // from the .argument() declarations in declaration order, so without this
    // override the help contradicted the parsing order (todos 5002ed12).
    .usage("[options] <channel> <message>")
    .argument("<message>", "Message content")
    .argument("[channel]", "Channel name — positional form: `send <channel> \"<message>\"`")
    .option("--from <agent>", "Sender agent ID")
    .option("--session <id>", "Session ID (auto-generated if omitted)")
    .option("--priority <level>", "Priority: low, normal, high, urgent", "normal")
    .option("--working-dir <path>", "Working directory context")
    .option("--repository <repo>", "Repository context")
    .option("--branch <branch>", "Branch context")
    .option("--metadata <json>", "JSON metadata string")
    .option("--channel <name>", "Channel to send to (agent-addressed DMs were removed)")
    .option("--attach <file...>", "Attach one or more files")
    .option("--attachment <file...>", "Alias for --attach")
    .option("--reply-to <message-reference>", "Reply to a parent UUID, or numeric ID with --channel/--session")
    .option("--blocking", "Send as a blocking message (recipient must acknowledge)")
    .option("-j, --json", "Output as JSON")
    .action(async (message, channelArg, opts) => {
      const from = resolveIdentity(opts.from).trim();
      let to = typeof opts.to === "string" ? opts.to.trim() : "";
      let channel = typeof opts.channel === "string" ? opts.channel.trim() : "";
      let content = typeof message === "string" ? message : "";
      let session = typeof opts.session === "string" && opts.session.trim()
        ? opts.session.trim()
        : undefined;
      let replyTo: number | undefined;
      let replyToUuid: string | undefined;

      // Documented positional form `send <channel> "<message>"` (charter
      // working agreement, .claude/rules, dispatch briefs): when a second
      // positional is present, the FIRST positional is the channel and the
      // SECOND is the message. Before this branch, the channel token bound to
      // <message> and the real body was silently dropped as an excess
      // argument, so the documented form exited rc=1 "Recipient is required"
      // (todos 4a2a4ac1). The single-positional forms
      // (`send "<message>" --channel X`, `send "<message>" --to A`) are
      // unchanged: channelArg is absent there.
      if (typeof channelArg === "string" && channelArg.length > 0) {
        const positionalChannel = message.trim();
        if (channel && normalizeChannelName(channel) !== normalizeChannelName(positionalChannel)) {
          emitCliError(
            `Ambiguous channel: positional ${positionalChannel} differs from --channel ${channel}.`,
            opts,
          );
        }
        channel = positionalChannel;
        content = channelArg;
      }

      if (!from) {
        emitCliError("Sender identity is required.", opts);
      }

      if (opts.replyTo !== undefined) {
        const ref = parseMessageReference(opts.replyTo);
        if (!ref) {
          emitCliError(
            `--reply-to must be a positive message id or UUID (got: ${String(opts.replyTo)}).`,
            opts,
          );
        }
        if (ref.kind === "id" && !channel && !session) {
          emitCliError(
            "Numeric --reply-to values require independent scope before a reply can be written. " +
              "Pass --channel <name> or --session <id>, or use the parent UUID from send/show output.",
            opts,
          );
        }

        const expectedChannel = channel ? normalizeChannelName(channel) : undefined;
        const parent = await resolveMessageReference(getStore(), ref, {
          channel: expectedChannel,
          session_id: session,
        });
        if (!parent) {
          emitCliError(`Message ${String(opts.replyTo)} not found.`, opts);
        }
        if (!parent.uuid) {
          emitCliError("Parent message has no immutable UUID; refusing to write a numeric-only reply.", opts);
        }

        const parentChannel = messageChannel(parent);
        if (expectedChannel && expectedChannel !== parentChannel) {
          emitCliError(
            `Expected parent channel ${expectedChannel} does not match resolved channel ${parentChannel ?? "(direct message)"}.`,
            opts,
          );
        }
        if (session && session !== parent.session_id) {
          emitCliError(
            `Expected parent session ${session} does not match resolved session ${parent.session_id}.`,
            opts,
          );
        }

        const resolvedTo = parentChannel
          ? parentChannel
          : (parent.from_agent === from ? parent.to_agent : parent.from_agent);
        if (to && to.toLowerCase() !== resolvedTo.toLowerCase()) {
          emitCliError(
            `Recipient ${to} does not match the reply target ${resolvedTo} resolved from the parent.`,
            opts,
          );
        }
        to = resolvedTo;
        channel = parentChannel ?? "";
        session = parent.session_id;
        replyTo = parent.id;
        replyToUuid = parent.uuid;
      }

      // Agent-addressed DMs were removed from conversations (staged behind the
      // messages-app v1 release gate). A channel-less send is a DM whether the
      // recipient came from --to (removed) or from a reply whose parent is a
      // direct message — refuse both.
      if (!channel) {
        if (!to) {
          emitCliError("Recipient is required: use --channel <name>.", opts);
        }
        emitCliError(
          "Agent-addressed direct messages were removed from conversations. Use the @hasna/messages app for agent-to-agent DMs.",
          opts,
        );
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

      const attachmentPaths = [
        ...(Array.isArray(opts.attach) ? opts.attach : []),
        ...(Array.isArray(opts.attachment) ? opts.attachment : []),
      ].filter((path): path is string => typeof path === "string" && path.length > 0);
      const attachments = attachmentPaths.map((sourcePath) => ({
        name: basename(sourcePath),
        source_path: sourcePath,
      }));

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
          attachments,
          reply_to: replyTo,
          reply_to_uuid: replyToUuid,
        });
      } catch (error) {
        return failCommand(error, "Failed to send message.");
      }

      const redaction = warnIfRedacted(content, msg.content);

      if (opts.json) {
        printJson({ ...msg, redaction });
      } else if (channel) {
        printLine(chalk.green(`Message sent to #${channel}`) + chalk.dim(` (uuid: ${msg.uuid}, id: ${msg.id})`));
      } else {
        printLine(chalk.green(`Message sent`) + chalk.dim(` (uuid: ${msg.uuid}, id: ${msg.id}, session: ${msg.session_id})`));
      }
      closeDb();
    });

  // ---- read ----
  program
    .command("read")
    .description("Read messages")
    .option("--session <id>", "Filter by session ID")
    .option("--sender <agent>", SENDER_HELP)
    .option("--from <agent>", FROM_ALIAS_HELP)
    .option("--channel <name>", "Filter by channel")
    .option("--since <timestamp>", "Messages after this ISO timestamp")
    .option("--since-id <message-id>", "Messages after this numeric ID (oldest unseen first)", parseInt)
    .option("--limit <n>", "Max messages to return", parseInt)
    .option("--cursor <n>", "Skip first N messages for pagination", parseInt)
    .option("--unread", "Only unread messages")
    .option("--unread-only", "Only unread messages")
    .option("--mark-read", "Mark returned messages as read")
    .option("--verbose", "Show full message bodies")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const senderFilter = resolveSenderFilter(opts);
      if (senderFilter.viaFromAlias) noteSenderFilterAlias(senderFilter.sender as string);
      const window = getCliWindow({ limit: opts.limit, cursor: opts.cursor });
      const sinceId = opts.sinceId === undefined
        ? undefined
        : parseNonNegativeInteger(opts.sinceId);
      if (opts.sinceId !== undefined && sinceId === undefined) {
        emitCliError("--since-id must be a non-negative integer.", opts);
      }
      const query = {
        session_id: opts.session,
        from: senderFilter.sender,
        channel: opts.channel,
        since: opts.since,
        since_id: sinceId,
        limit: opts.json ? opts.limit : queryLimitFor(window),
        offset: opts.json ? opts.cursor : window.offset,
        unread_only: opts.unread || opts.unreadOnly,
      };
      if (opts.json) {
        const page = await getStore().readMessagePreviews(query);
        if (opts.markRead) {
          const reader = resolveIdentity(undefined);
          const ids = page.messages.filter((message) => message.unread).map((message) => message.id);
          if (ids.length > 0) await await getStore().markReadByIds(ids, reader);
        }
        if (page.messages.length === 0) {
          discloseEmptyResult({
            channel: opts.channel,
            sender: senderFilter.sender,
            session: opts.session,
            since: opts.since,
          }, { senderFlag: senderFilter.flag });
        }
        printJson(page);
        warnIfPageFull(page.count + page.skipped_count, query.limit);
      } else {
        const messages = await getStore().readMessages(query);
        const page = pageFromQuery(messages, window, { newestWindow: resolveReadWindow(query).newestWindow });
        if (opts.markRead) {
          const reader = resolveIdentity(undefined);
          const ids = page.items.filter((message) => !message.read_at).map((message) => message.id);
          if (ids.length > 0) await await getStore().markReadByIds(ids, reader);
        }
        if (messages.length === 0) {
          discloseEmptyResult({
            channel: opts.channel,
            sender: senderFilter.sender,
            session: opts.session,
            since: opts.since,
          }, { senderFlag: senderFilter.flag });
        }
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
    .description("Show a full message by numeric ID or immutable UUID")
    .argument("<reference>", "Numeric message ID or UUID")
    .option("-j, --json", "Output as JSON")
    .action(async (idArg, opts) => {
      const ref = parseMessageReference(idArg);
      if (!ref) {
        emitCliError("Message reference must be a positive numeric ID or UUID.", opts);
      }

      const msg = ref.kind === "id"
        ? await getStore().getMessageById(ref.id)
        : await getStore().getMessageByUuid(ref.uuid);
      if (!msg) {
        emitCliError(`Message ${String(idArg)} not found.`, opts);
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
        printReactionRow(msg.reactions);
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
    .option("--unread", "Only include unread messages")
    .option("--mark-read", "Mark returned messages read after building the digest")
    .option("--from <agent>", "Reader identity for --mark-read")
    .option("-j, --json", "Output as JSON")
    .action(async (channelArg, opts) => {
      const channel = typeof channelArg === "string" && channelArg.trim() ? channelArg.trim() : undefined;
      // Agent-addressed DMs were removed from conversations (staged behind the
      // messages-app v1 release gate); the digest is channel-scoped only.
      if (!channel) {
        emitCliError("Provide a channel name to digest.", opts);
      }

      const reader = opts.markRead ? resolveIdentity(opts.from).trim() : undefined;
      if (opts.markRead && !reader) {
        emitCliError("Reader identity is required for --mark-read.", opts);
      }

      let result;
      try {
        result = await await getStore().readDigest({
          channel,
          since: opts.since,
          cursor: opts.cursor,
          max_bytes: opts.maxBytes,
          limit: opts.limit,
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
            printReactionRow(msg.reactions);
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
    .option("--sender <agent>", SENDER_HELP)
    .option("--from <agent>", FROM_ALIAS_HELP)
    .option("--since <timestamp>", "Only messages at or after this absolute ISO-8601 timestamp")
    .option("--limit <n>", "Max results to return (the server caps a single page at 500)", parseInt)
    .option("--cursor <n>", "Skip first N results for pagination", parseInt)
    .option("--verbose", "Show full message bodies in human output")
    .option("-j, --json", "Output as JSON")
    .addHelpText("after", `
Search is bounded in two ways. Both bite hardest on the thing search is most
used for — auditing a sender or a channel, which is an ABSENCE claim.

  1. PAGE SIZE. A single page is capped at 500 rows server-side; --limit above
     that is clamped, not honoured. The cap is always disclosed: text output
     prints "More available: rerun with --cursor N", and --json returns a
     compact envelope carrying has_more, next_cursor, max_bytes, and byte_length.
     Page with --cursor until has_more is false.

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
     population from a content search.

  3. --from IS A SENDER FILTER HERE, NOT YOUR IDENTITY. On nearly every other
     subcommand --from names the caller; on search, read and export it appends
     "AND from_agent = <value>" to your query. So the liveness probe

         conversations search <token> --channel <c> --from <me>

     is unsatisfiable by construction — a dispatched sub-agent is a DIFFERENT
     sender, so the one message you are looking for is the one the filter
     removes. It answered "No messages found." at rc=0 with an empty stderr
     (todos 807d355d). --from still filters, and now always says so; --sender is
     the unambiguous spelling. For identity, set CONVERSATIONS_AGENT_ID.`)
    .action(async (query, opts) => {
      const q = typeof query === "string" ? query.trim() : "";
      if (!q) {
        emitCliError("Search query cannot be empty.", opts);
      }
      const senderFilter = resolveSenderFilter(opts);
      if (senderFilter.viaFromAlias) noteSenderFilterAlias(senderFilter.sender as string);
      const window = getCliWindow({ limit: opts.limit, cursor: opts.cursor });
      let since: string | undefined;
      try {
        since = opts.since === undefined ? undefined : normalizeExactIsoTimestamp(opts.since, "--since timestamp");
      } catch (error) {
        emitCliError(error instanceof Error ? error.message : String(error), opts);
      }

      // The store pages this verb now. `--json` used to pass the raw limit and
      // then hardcode `hasMore: false`, so a result cut short by the backend's
      // 500-row cap was published as a complete set (todos 83852845).
      const result = await getStore().searchMessagesPage({
        query: q,
        channel: opts.channel,
        from: senderFilter.sender,
        since,
        limit: opts.json ? opts.limit : window.limit,
        offset: opts.json ? opts.cursor : window.offset,
      });
      if (result.items.length === 0) {
        discloseEmptyResult({
          query: q,
          channel: opts.channel,
          sender: senderFilter.sender,
        }, { senderFlag: senderFilter.flag });
      }
      const disclosure = {
        shown: result.items.length,
        hasMore: result.has_more,
        nextCursor: result.next_cursor,
        sort: getStore().describeListOrder("search"),
      };

      if (opts.json) {
        printJsonLine(buildCompactSearchEnvelope({
          page: result,
          query: q,
          channel: opts.channel,
          from: senderFilter.sender,
          since,
          cursor: opts.cursor,
        }));
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
      const since = new Date(Date.now() - value * msMap[unit]).toISOString();
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
    .description("Reply to a message by immutable UUID, or by numeric ID with independent scope")
    .argument("<message>", "Reply content")
    .requiredOption("--to <message-reference>", "Parent UUID, or numeric ID with --channel/--session")
    .option("--channel <name>", "Expected parent channel (required for a numeric channel-message ID)")
    .option("--session <id>", "Expected parent session (required for a numeric DM/session ID)")
    .option("--from <agent>", "Sender agent ID")
    .option("--priority <level>", "Priority: low, normal, high, urgent", "normal")
    .option("-j, --json", "Output as JSON")
    .action(async (message, opts) => {
      const ref = parseMessageReference(opts.to);
      if (!ref) {
        emitCliError(`--to must be a positive message id or UUID (got: ${String(opts.to)}).`, opts);
      }
      if (ref.kind === "id" && !opts.channel && !opts.session) {
        emitCliError(
          "Numeric message IDs require independent scope before a reply can be written. " +
            "Pass --channel <name> or --session <id>, or use the parent UUID from send/show output.",
          opts,
        );
      }

      const expectedChannel = opts.channel ? normalizeChannelName(opts.channel) : undefined;
      const original = await resolveMessageReference(getStore(), ref, {
        channel: expectedChannel,
        session_id: opts.session,
      });
      if (!original) {
        emitCliError(`Message ${String(opts.to)} not found.`, opts);
      }
      if (!original.uuid) {
        emitCliError("Parent message has no immutable UUID; refusing to write a numeric-only reply.", opts);
      }

      const from = resolveIdentity(opts.from).trim();
      const content = typeof message === "string" ? message : "";
      if (!from) {
        emitCliError("Sender identity is required.", opts);
      }
      if (!content.trim()) {
        emitCliError("Reply content cannot be empty.", opts);
      }
      const channel = messageChannel(original);
      if (expectedChannel && expectedChannel !== channel) {
        emitCliError(
          `Expected parent channel ${expectedChannel} does not match resolved channel ${channel ?? "(direct message)"}.`,
          opts,
        );
      }
      if (opts.session && opts.session !== original.session_id) {
        emitCliError(
          `Expected parent session ${opts.session} does not match resolved session ${original.session_id}.`,
          opts,
        );
      }
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
          reply_to: original.id,
          reply_to_uuid: original.uuid,
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
      if (msg.reply_to !== original.id) {
        emitCliError(
          `Reply was stored as message #${msg.id} but its parent link did not persist ` +
            `(expected reply_to=${original.id}, stored ${JSON.stringify(msg.reply_to)}). ` +
            `The message is NOT threaded — check that the conversations server supports reply_to.`,
          opts,
          { id: msg.id, expected_reply_to: original.id, stored_reply_to: msg.reply_to ?? null },
        );
      }

      const redaction = warnIfRedacted(content, msg.content);

      if (opts.json) {
        printJson({ ...msg, redaction });
      } else {
        printLine(chalk.green(`Reply sent`) + chalk.dim(` (uuid: ${msg.uuid}, id: ${msg.id}, session: ${msg.session_id})`));
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
    .option("--sender <agent>", SENDER_HELP)
    .option("--from <agent>", FROM_ALIAS_HELP)
    .option("--since <date>", "Messages after this ISO date")
    .option("--until <date>", "Messages before this ISO date")
    .option("--format <format>", "Output format: json or csv", "json")
    .action(async (opts) => {
      const senderFilter = resolveSenderFilter(opts);
      if (senderFilter.viaFromAlias) noteSenderFilterAlias(senderFilter.sender as string);
      const format = opts.format === "csv" ? "csv" : "json";
      const result = await getStore().exportMessages({
        channel: opts.channel,
        session_id: opts.session,
        from: senderFilter.sender,
        since: normalizeSince(opts.since),
        until: opts.until,
        format,
      });

      if (result.count === 0) {
        discloseEmptyResult({
          channel: opts.channel,
          sender: senderFilter.sender,
          session: opts.session,
          since: opts.since,
        }, { senderFlag: senderFilter.flag });
      }

      printJson(result);
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
      if (opts.json) {
        const page = await await getStore().readPinnedMessagePreviews({
          channel: opts.channel,
          session_id: opts.session,
          limit: opts.limit,
          offset: opts.cursor,
        });
        printJson(page);
      } else {
        const messages = await await getStore().getPinnedMessages({
          channel: opts.channel,
          session_id: opts.session,
          limit: queryLimitFor(window),
          offset: window.offset,
        });
        const page = pageFromQuery(messages, window);
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
      // The resolved byline (--from, or the session default) is forwarded
      // unconditionally: the API key authorizes, the byline scopes (task
      // 1871c67f). Omitting the default identity was the fleet-wide unscoped
      // read; the pre-fix equality 403 is gone, so `blockers` without --from
      // is seat-scoped at rc=0.
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

      const page = await getStore().readChannelNotifications({
        agent,
        channel: opts.channel,
        since: normalizeSince(opts.since),
        unread_only: !opts.all,
        limit: opts.limit,
        mark_read: opts.markRead,
      });

      if (opts.json) {
        printJson(page);
      } else if (page.notifications.length === 0) {
        printLine(chalk.dim("No channel notifications."));
      } else {
        for (const item of page.notifications) {
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
    .option("--verbose", "Show full DM bodies (channel notifications stay preview-only)")
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

      const { startPolling } = require("../../lib/poll.js") as typeof import("../../lib/poll.js");
      const {
        baselineChannelNotifications,
        startNotificationPolling,
      } = require("../../lib/poll-notifications.js") as typeof import("../../lib/poll-notifications.js");
      const { renderContent: renderContentLocal } = require("../../lib/terminal-markdown.js");

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
        // branch names all arrive with their separators replaced by spaces. That
        // is unrecoverable HERE by design — the continuation line names the
        // exact-id route that does recover it, one message at a time.
        printLine(`    ${notification.preview}`);
        printLine(chalk.dim(`    Preview only. Inspect with: conversations show ${notification.message_id}`));
        printLine(chalk.dim("    " + "·".repeat(Math.min(cols - 8, 60))));
        printLine("");
      };

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
          sendDesktopNotification(`${msg.from_agent} (${where})`, preview);
        }
      };

      const onNewNotifications = (notifications: import("../../types.js").ChannelNotification[]) => {
        for (const notification of notifications) {
          const fresh = !renderedNotifications.has(notification.message_id);
          renderNotification(notification);
          if (fresh) {
            sendDesktopNotification(`${notification.from_agent} (#${notification.channel})`, notification.preview);
          }
        }
      };

      let ready = false;
      const queuedMessages: import("../../types.js").Message[] = [];
      const queueOrRenderMessages = (messages: import("../../types.js").Message[]) => {
        if (!ready) {
          queuedMessages.push(...messages);
          return;
        }
        onNewMessages(messages);
      };

      const stops: Array<{ stop: () => void | Promise<void> }> = [];
      const pollReady: Promise<void>[] = [];

      if (opts.all) {
        await baselineChannelNotifications(store, identities);

        // One DM loop per identity: `to_agent` is a single-value filter, and a
        // seat's two queues are disjoint.
        for (const identity of identities) {
          const poll = startPolling({
            to_agent: identity,
            interval_ms: interval,
            on_messages: queueOrRenderMessages,
          });
          stops.push(poll);
          pollReady.push(poll.ready);
        }
      } else if (opts.channel) {
        const poll = startPolling({
          channel: opts.channel,
          interval_ms: interval,
          on_messages: queueOrRenderMessages,
        });
        stops.push(poll);
        pollReady.push(poll.ready);
      } else {
        for (const identity of identities) {
          const poll = startPolling({
            to_agent: identity,
            interval_ms: interval,
            on_messages: queueOrRenderMessages,
          });
          stops.push(poll);
          pollReady.push(poll.ready);
        }
      }

      await Promise.all(pollReady);

      printLine("");
      printLine(chalk.bold(`  Conversations`) + chalk.dim(` — watching as ${identityLabel}`));
      printLine(chalk.dim(`  ${modeLabel} · Poll: ${interval}ms · Ctrl+C to stop`));
      printLine(chalk.dim("  " + "─".repeat(cols - 4)));
      printLine("");

      ready = true;
      if (queuedMessages.length > 0) onNewMessages(queuedMessages.splice(0));
      if (opts.all) {
        stops.push(startNotificationPolling({
          store,
          agent,
          agents: identities,
          interval_ms: interval,
          on_notifications: onNewNotifications,
        }));
      }

      process.on("SIGINT", () => {
        for (const stop of stops) void stop.stop();
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
