import type { Command } from "commander";
import chalk from "chalk";
import { sendMessage, readMessages, readDigest, markRead, markSessionRead, markSpaceRead, markAllRead, getMessageById, searchMessages, exportMessages, deleteMessage, editMessage, pinMessage, unpinMessage, getPinnedMessages, getUnreadBlockers } from "../../lib/messages.js";
import { closeDb } from "../../lib/db.js";
import { resolveIdentity } from "../../lib/identity.js";
import { renderContent } from "../../lib/terminal-markdown.js";
import { heartbeat } from "../../lib/presence.js";
import { getDb } from "../../lib/db.js";

export function registerMessagingCommands(program: Command): void {
  // ---- send ----
  program
    .command("send")
    .description("Send a message to an agent")
    .argument("<message>", "Message content")
    .option("--to <agent>", "Recipient agent ID (required unless --space is used)")
    .option("--from <agent>", "Sender agent ID")
    .option("--session <id>", "Session ID (auto-generated if omitted)")
    .option("--priority <level>", "Priority: low, normal, high, urgent", "normal")
    .option("--working-dir <path>", "Working directory context")
    .option("--repository <repo>", "Repository context")
    .option("--branch <branch>", "Branch context")
    .option("--metadata <json>", "JSON metadata string")
    .option("--space <name>", "Send to a space instead of a specific agent")
    .option("--blocking", "Send as a blocking message (recipient must acknowledge)")
    .option("-j, --json", "Output as JSON")
    .action((message, opts) => {
      const from = resolveIdentity(opts.from).trim();
      const to = typeof opts.to === "string" ? opts.to.trim() : "";
      const space = typeof opts.space === "string" ? opts.space.trim() : "";
      const content = typeof message === "string" ? message : "";
      const session = typeof opts.session === "string" && opts.session.trim()
        ? opts.session.trim()
        : undefined;

      if (!from) {
        console.error(chalk.red("Sender identity is required."));
        process.exit(1);
      }
      if (!to && !space) {
        console.error(chalk.red("Recipient is required: use --to <agent> or --space <name>."));
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

      const msg = sendMessage({
        from,
        to: to || from,
        space: space || undefined,
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
      } else if (space) {
        console.log(chalk.green(`Message sent to #${space}`) + chalk.dim(` (id: ${msg.id})`));
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
    .option("--space <name>", "Filter by space")
    .option("--since <timestamp>", "Messages after this ISO timestamp")
    .option("--limit <n>", "Max messages to return", parseInt)
    .option("--unread", "Only unread messages")
    .option("--mark-read", "Mark returned messages as read")
    .option("-j, --json", "Output as JSON")
    .action((opts) => {
      const messages = readMessages({
        session_id: opts.session,
        from: opts.from,
        to: opts.to,
        space: opts.space,
        since: opts.since,
        limit: opts.limit,
        unread_only: opts.unread,
      });

      if (opts.markRead) {
        const reader = resolveIdentity(opts.to);
        if (opts.space) {
          markSpaceRead(opts.space, reader);
        } else if (opts.session) {
          markSessionRead(opts.session, reader);
        } else {
          const ids = messages.filter((m) => m.to_agent === reader && !m.read_at).map((m) => m.id);
          if (ids.length > 0) markRead(ids, reader);
        }
      }

      if (opts.json) {
        console.log(JSON.stringify(messages, null, 2));
      } else {
        if (messages.length === 0) {
          console.log(chalk.dim("No messages found."));
        } else {
          for (const msg of messages) {
            const time = chalk.dim(msg.created_at.slice(11, 19));
            const from = chalk.cyan(msg.from_agent);
            const to = msg.space ? chalk.magenta(`#${msg.space}`) : chalk.yellow(msg.to_agent);
            const priority = msg.priority !== "normal" ? chalk.red(` [${msg.priority}]`) : "";
            const unread = !msg.read_at ? chalk.green(" *") : "";
            console.log(`${time} ${from} → ${to}${priority}${unread}`);
            const rendered = renderContent(msg.content);
            const indented = rendered.split("\n").map((l: string) => "  " + l).join("\n");
            console.log(indented);
          }
        }
      }
      closeDb();
    });

  // ---- digest ----
  program
    .command("digest")
    .description("Show unread message digest (preview only, auto-marks read)")
    .argument("[space]", "Space name to digest (omit for DMs)")
    .option("--since <timestamp>", "Messages after this ISO timestamp")
    .option("--limit <n>", "Max messages to show", parseInt)
    .option("--to <agent>", "Filter by recipient (for DMs)")
    .option("-j, --json", "Output as JSON")
    .action((spaceArg, opts) => {
      const result = readDigest({
        space: spaceArg || undefined,
        since: opts.since,
        limit: opts.limit,
        to: opts.to,
      });

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(chalk.bold(`Unread: ${result.total_unread} total, showing ${result.shown}`));
        if (result.messages.length === 0) {
          console.log(chalk.dim("  No unread messages."));
        } else {
          for (const msg of result.messages) {
            const time = chalk.dim(msg.created_at.slice(11, 19));
            const from = chalk.cyan(msg.from);
            const dest = msg.space ? chalk.magenta(`#${msg.space}`) : chalk.yellow(msg.to ?? "?");
            const priority = msg.priority !== "normal" ? chalk.red(` [${msg.priority}]`) : "";
            const att = msg.has_attachments ? chalk.dim(" 📎") : "";
            console.log(`${time} ${from} → ${dest}${priority}${att}`);
            console.log(`  ${chalk.dim(msg.preview)}`);
          }
        }
      }
      closeDb();
    });

  // ---- search ----
  program
    .command("search")
    .description("Search messages by content")
    .argument("<query>", "Search query string")
    .option("--space <name>", "Filter by space")
    .option("--from <agent>", "Filter by sender")
    .option("--to <agent>", "Filter by recipient")
    .option("--limit <n>", "Max results to return", parseInt)
    .option("-j, --json", "Output as JSON")
    .action((query, opts) => {
      const q = typeof query === "string" ? query.trim() : "";
      if (!q) {
        console.error(chalk.red("Search query cannot be empty."));
        process.exit(1);
      }

      const messages = searchMessages({
        query: q,
        space: opts.space,
        from: opts.from,
        to: opts.to,
        limit: opts.limit,
      });

      if (opts.json) {
        console.log(JSON.stringify(messages, null, 2));
      } else {
        if (messages.length === 0) {
          console.log(chalk.dim("No messages found."));
        } else {
          console.log(chalk.dim(`Found ${messages.length} result(s) for "${q}":\n`));
          for (const msg of messages) {
            const time = chalk.dim(msg.created_at.slice(11, 19));
            const from = chalk.cyan(msg.from_agent);
            const to = msg.space ? chalk.magenta(`#${msg.space}`) : chalk.yellow(msg.to_agent);
            const priority = msg.priority !== "normal" ? chalk.red(` [${msg.priority}]`) : "";
            const unread = !msg.read_at ? chalk.green(" *") : "";
            console.log(`${time} ${from} → ${to}${priority}${unread}: ${msg.content}`);
          }
        }
      }
      closeDb();
    });

  // ---- since ----
  program
    .command("since")
    .description("Show all activity (DMs + spaces) since a duration ago")
    .argument("<duration>", "Duration: e.g. 30m, 2h, 1d")
    .option("-j, --json", "Output as JSON")
    .action((duration, opts) => {
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

      const messages = readMessages({ since, order: "asc", limit: 200 });

      if (opts.json) {
        console.log(JSON.stringify(messages, null, 2));
      } else {
        if (messages.length === 0) {
          console.log(chalk.dim(`No activity in the last ${duration}.`));
        } else {
          console.log(chalk.bold(`Activity since ${duration} ago (${messages.length} message(s)):\n`));
          for (const msg of messages) {
            const time = chalk.dim(msg.created_at.slice(11, 19));
            const from = chalk.cyan(msg.from_agent);
            const where = msg.space ? chalk.magenta(`#${msg.space}`) : chalk.yellow(`→ ${msg.to_agent}`);
            const priority = msg.priority !== "normal" ? chalk.red(` [${msg.priority}]`) : "";
            const unread = !msg.read_at ? chalk.green(" •") : "";
            const content = renderContent(msg.content);
            console.log(`${time} ${from} ${where}${priority}${unread}`);
            console.log(`       ${content}\n`);
          }
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
    .action((message, opts) => {
      const original = getMessageById(opts.to);
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
      const space =
        original.space ||
        (original.session_id?.startsWith("space:") ? original.session_id.slice(6) : undefined);
      const to = space
        ? space
        : (original.from_agent === from ? original.to_agent : original.from_agent);
      const msg = sendMessage({
        from,
        to,
        content,
        session_id: original.session_id,
        priority: opts.priority,
        space,
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
    .option("--space <name>", "Mark all messages in space as read")
    .option("--agent <id>", "Agent marking messages as read")
    .option("-j, --json", "Output as JSON")
    .action((ids, opts) => {
      const agent = resolveIdentity(opts.agent);
      let count = 0;

      if (opts.all) {
        count = markAllRead(agent);
      } else if (opts.session) {
        count = markSessionRead(opts.session, agent);
      } else if (opts.space) {
        count = markSpaceRead(opts.space, agent);
      } else if (ids.length > 0) {
        count = markRead(ids.map(Number), agent);
      } else {
        console.error(chalk.red("Provide message IDs, --all, --session, or --space flag."));
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
    .option("--space <name>", "Filter by space")
    .option("--session <id>", "Filter by session ID")
    .option("--from <agent>", "Filter by sender")
    .option("--since <date>", "Messages after this ISO date")
    .option("--until <date>", "Messages before this ISO date")
    .option("--format <format>", "Output format: json or csv", "json")
    .action((opts) => {
      const format = opts.format === "csv" ? "csv" : "json";
      const result = exportMessages({
        space: opts.space,
        session_id: opts.session,
        from: opts.from,
        since: opts.since,
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
    .action((id, newContent, opts) => {
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

      const msg = editMessage(id, agent, content);

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
    .action((id, opts) => {
      const agent = resolveIdentity(opts.from).trim();
      if (!agent) {
        console.error(chalk.red("Agent identity is required."));
        process.exit(1);
      }

      const result = deleteMessage(id, agent);

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
    .action((id, opts) => {
      const msg = pinMessage(id);

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
    .action((id, opts) => {
      const msg = unpinMessage(id);

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
    .option("--space <name>", "Filter by space")
    .option("--session <id>", "Filter by session ID")
    .option("--limit <n>", "Max results", parseInt)
    .option("-j, --json", "Output as JSON")
    .action((opts) => {
      const messages = getPinnedMessages({ space: opts.space, session_id: opts.session, limit: opts.limit });
      if (opts.json) {
        console.log(JSON.stringify(messages, null, 2));
      } else {
        if (messages.length === 0) {
          console.log(chalk.dim("No pinned messages."));
        } else {
          console.log(chalk.dim(`${messages.length} pinned message(s):\n`));
          for (const msg of messages) {
            const time = chalk.dim(msg.created_at.slice(11, 19));
            const from = chalk.cyan(msg.from_agent);
            const where = msg.space ? chalk.magenta(`#${msg.space}`) : chalk.yellow(msg.to_agent);
            console.log(`${chalk.yellow("📌")} [#${msg.id}] ${time} ${from} → ${where}: ${msg.content}`);
          }
        }
      }
      closeDb();
    });

  // ---- blockers ----
  program
    .command("blockers")
    .description("Check for unread blocking messages")
    .option("--from <agent>", "Agent to check blockers for")
    .option("-j, --json", "Output as JSON")
    .action((opts) => {
      const agent = resolveIdentity(opts.from);
      const blockers = getUnreadBlockers(agent);

      if (opts.json) {
        console.log(JSON.stringify(blockers, null, 2));
      } else {
        if (blockers.length === 0) {
          console.log(chalk.dim("No blocking messages."));
        } else {
          console.log(chalk.red.bold(`${blockers.length} blocking message(s):\n`));
          for (const b of blockers) {
            const where = b.space ? chalk.magenta(`#${b.space}`) : chalk.yellow("DM");
            const time = chalk.dim(b.created_at.slice(11, 19));
            console.log(`  ${chalk.red(`[#${b.id}]`)} ${time} ${chalk.cyan(b.from_agent)} ${where}: ${b.content}`);
          }
          console.log(chalk.dim(`\nAcknowledge with: conversations mark-read ${blockers.map(b => b.id).join(" ")}`));
        }
      }
      closeDb();
    });

  // ---- watch ----
  program
    .command("watch")
    .description("Watch for new messages with desktop notifications")
    .option("--from <agent>", "Your agent identity")
    .option("--space <name>", "Watch a specific space")
    .option("--all", "Watch DMs and all subscribed spaces")
    .option("--interval <ms>", "Poll interval in milliseconds", parseInt)
    .action((opts) => {
      const agent = resolveIdentity(opts.from);
      heartbeat(agent);

      const interval = Number.isFinite(opts.interval) && opts.interval > 0 ? opts.interval : 1000;
      const cols = Math.min(process.stdout.columns || 80, 100);

      // Resolve the agent's subscribed spaces when --all is used
      let agentSpaces: string[] = [];
      if (opts.all) {
        const db = getDb();
        const rows = db.prepare("SELECT space FROM space_members WHERE agent = ?").all(agent) as { space: string }[];
        agentSpaces = rows.map(r => r.space);
      }

      const modeLabel = opts.all
        ? `DMs + ${agentSpaces.length} space(s)`
        : opts.space ? `Space: #${opts.space}` : "All DMs";

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
        const where = msg.space
          ? chalk.magenta(`#${msg.space}`)
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
        const content = renderContentLocal(msg.content) as string;
        const indented = content.split("\n").map((l: string) => "    " + l).join("\n");
        console.log(indented);

        // Separator
        console.log(chalk.dim("    " + "·".repeat(Math.min(cols - 8, 60))));
        console.log("");
      };

      // Show recent messages first
      if (opts.all) {
        // Combine DMs and all space messages
        const dmRecent = readMessages({ to: agent, limit: 20, order: "asc" });
        const spaceRecent: import("../../types.js").Message[] = [];
        for (const sp of agentSpaces) {
          spaceRecent.push(...readMessages({ space: sp, limit: 10, order: "asc" }));
        }
        const recent = [...dmRecent, ...spaceRecent]
          .sort((a, b) => a.created_at.localeCompare(b.created_at))
          .slice(-20);
        if (recent.length > 0) {
          console.log(chalk.dim(`  ── Recent messages (${recent.length}) ──\n`));
          for (const msg of recent) { renderMessage(msg); }
          console.log(chalk.dim(`  ── Live ──\n`));
        }
      } else {
        const recent = readMessages({
          to: opts.space ? undefined : agent,
          space: opts.space,
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
          const where = msg.space ? `#${msg.space}` : "DM";
          const preview = msg.content.replace(/[*#`~_>\-]/g, "").slice(0, 150);
          desktopNotify(`${msg.from_agent} (${where})`, preview);
        }
      };

      if (opts.all) {
        // Start a poller for DMs
        startPolling({ to_agent: agent, interval_ms: interval, on_messages: onNewMessages });
        // Start a poller for each subscribed space
        for (const sp of agentSpaces) {
          startPolling({ space: sp, interval_ms: interval, on_messages: onNewMessages });
        }
      } else {
        startPolling({
          to_agent: opts.space ? undefined : agent,
          space: opts.space,
          interval_ms: interval,
          on_messages: onNewMessages,
        });
      }

      process.on("SIGINT", () => {
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
      const pkg = await import("../../../package.json");
      const current = pkg.version;

      let latest: string;
      try {
        const res = await fetch("https://registry.npmjs.org/@hasna/conversations/latest");
        const data = await res.json() as { version: string };
        latest = data.version;
      } catch {
        if (opts.json) {
          console.log(JSON.stringify({ error: "Failed to check npm registry" }));
        } else {
          console.error(chalk.red("Failed to check npm registry for updates."));
        }
        process.exit(1);
      }

      const updateAvailable = current !== latest;

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
