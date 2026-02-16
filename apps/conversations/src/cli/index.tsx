#!/usr/bin/env bun
import { Command } from "commander";
import chalk from "chalk";
import { render } from "ink";
import React from "react";
import { sendMessage, readMessages, markRead, markSessionRead, markChannelRead, getMessageById } from "../lib/messages.js";
import { listSessions, getSession } from "../lib/sessions.js";
import { createChannel, listChannels, getChannel, joinChannel, leaveChannel, getChannelMembers } from "../lib/channels.js";
import { getDb, getDbPath, closeDb } from "../lib/db.js";
import { resolveIdentity } from "../lib/identity.js";
import { App } from "./components/App.js";

const program = new Command();

program
  .name("conversations")
  .description("Real-time CLI messaging for AI agents")
  .version("0.0.8");

// ---- send ----
program
  .command("send")
  .description("Send a message to an agent")
  .argument("<message>", "Message content")
  .requiredOption("--to <agent>", "Recipient agent ID")
  .option("--from <agent>", "Sender agent ID")
  .option("--session <id>", "Session ID (auto-generated if omitted)")
  .option("--priority <level>", "Priority: low, normal, high, urgent", "normal")
  .option("--working-dir <path>", "Working directory context")
  .option("--repository <repo>", "Repository context")
  .option("--branch <branch>", "Branch context")
  .option("--metadata <json>", "JSON metadata string")
  .option("--json", "Output as JSON")
  .action((message, opts) => {
    const from = resolveIdentity(opts.from).trim();
    const to = typeof opts.to === "string" ? opts.to.trim() : "";
    const content = typeof message === "string" ? message : "";
    const session = typeof opts.session === "string" && opts.session.trim()
      ? opts.session.trim()
      : undefined;

    if (!from) {
      console.error(chalk.red("Sender identity is required."));
      process.exit(1);
    }
    if (!to) {
      console.error(chalk.red("Recipient is required."));
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
      to,
      content,
      session_id: session,
      priority: opts.priority,
      working_dir: opts.workingDir,
      repository: opts.repository,
      branch: opts.branch,
      metadata,
    });

    if (opts.json) {
      console.log(JSON.stringify(msg, null, 2));
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
  .option("--unread", "Only unread messages")
  .option("--mark-read", "Mark returned messages as read")
  .option("--json", "Output as JSON")
  .action((opts) => {
    const messages = readMessages({
      session_id: opts.session,
      from: opts.from,
      to: opts.to,
      channel: opts.channel,
      since: opts.since,
      limit: opts.limit,
      unread_only: opts.unread,
    });

    if (opts.markRead) {
      const reader = resolveIdentity(opts.to);
      if (opts.channel) {
        markChannelRead(opts.channel, reader);
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
          const to = msg.channel ? chalk.magenta(`#${msg.channel}`) : chalk.yellow(msg.to_agent);
          const priority = msg.priority !== "normal" ? chalk.red(` [${msg.priority}]`) : "";
          const unread = !msg.read_at ? chalk.green(" *") : "";
          console.log(`${time} ${from} → ${to}${priority}${unread}: ${msg.content}`);
        }
      }
    }
    closeDb();
  });

// ---- sessions ----
program
  .command("sessions")
  .description("List conversation sessions")
  .option("--agent <id>", "Filter sessions involving this agent")
  .option("--json", "Output as JSON")
  .action((opts) => {
    const sessions = listSessions(opts.agent);

    if (opts.json) {
      console.log(JSON.stringify(sessions, null, 2));
    } else {
      if (sessions.length === 0) {
        console.log(chalk.dim("No sessions found."));
      } else {
        for (const s of sessions) {
          const unread = s.unread_count > 0 ? chalk.green(` (${s.unread_count} unread)`) : "";
          const participants = s.participants.join(", ");
          console.log(
            `${chalk.bold(s.session_id)} — ${participants} — ${s.message_count} messages${unread}`
          );
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
  .option("--json", "Output as JSON")
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
    const channel =
      original.channel ||
      (original.session_id?.startsWith("channel:") ? original.session_id.slice(8) : undefined);
    const to = channel
      ? channel
      : (original.from_agent === from ? original.to_agent : original.from_agent);
    const msg = sendMessage({
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
  .option("--session <id>", "Mark all messages in session as read")
  .option("--channel <name>", "Mark all messages in channel as read")
  .option("--agent <id>", "Agent marking messages as read")
  .option("--json", "Output as JSON")
  .action((ids, opts) => {
    const agent = resolveIdentity(opts.agent);
    let count = 0;

    if (opts.session) {
      count = markSessionRead(opts.session, agent);
    } else if (opts.channel) {
      count = markChannelRead(opts.channel, agent);
    } else if (ids.length > 0) {
      count = markRead(ids.map(Number), agent);
    } else {
      console.error(chalk.red("Provide message IDs, --session, or --channel flag."));
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify({ marked_read: count }));
    } else {
      console.log(chalk.green(`Marked ${count} message(s) as read.`));
    }
    closeDb();
  });

// ---- status ----
program
  .command("status")
  .description("Show database stats")
  .option("--json", "Output as JSON")
  .action((opts) => {
    const db = getDb();
    const dbPath = getDbPath();
    const totalMessages = (db.prepare("SELECT COUNT(*) as count FROM messages").get() as { count: number }).count;
    const totalSessions = (db.prepare("SELECT COUNT(DISTINCT session_id) as count FROM messages").get() as { count: number }).count;
    const totalUnread = (db.prepare("SELECT COUNT(*) as count FROM messages WHERE read_at IS NULL").get() as { count: number }).count;
    const totalChannels = (db.prepare("SELECT COUNT(*) as count FROM channels").get() as { count: number }).count;

    const stats = {
      db_path: dbPath,
      total_messages: totalMessages,
      total_sessions: totalSessions,
      total_channels: totalChannels,
      unread_messages: totalUnread,
    };

    if (opts.json) {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      console.log(chalk.bold("Conversations Status"));
      console.log(`  DB Path:    ${stats.db_path}`);
      console.log(`  Messages:   ${stats.total_messages}`);
      console.log(`  Sessions:   ${stats.total_sessions}`);
      console.log(`  Channels:   ${stats.total_channels}`);
      console.log(`  Unread:     ${stats.unread_messages}`);
    }
    closeDb();
  });

// ---- update ----
program
  .command("update")
  .description("Check for and install updates")
  .option("--check", "Only check for updates, don't install")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const pkg = await import("../../package.json");
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

// ---- channel ----
const channel = program
  .command("channel")
  .description("Manage channels");

channel
  .command("create")
  .description("Create a new channel")
  .argument("<name>", "Channel name")
  .option("--description <text>", "Channel description")
  .option("--from <agent>", "Creator agent ID")
  .option("--json", "Output as JSON")
  .action((name, opts) => {
    const agent = resolveIdentity(opts.from).trim();
    const channelName = typeof name === "string" ? name.trim() : "";
    if (!agent) {
      console.error(chalk.red("Creator identity is required."));
      process.exit(1);
    }
    if (!channelName) {
      console.error(chalk.red("Channel name cannot be empty."));
      process.exit(1);
    }
    try {
      const description = typeof opts.description === "string" && opts.description.trim()
        ? opts.description.trim()
        : undefined;
      const ch = createChannel(channelName, agent, description);
      if (opts.json) {
        console.log(JSON.stringify(ch, null, 2));
      } else {
        console.log(chalk.green(`Channel #${ch.name} created`) + (ch.description ? chalk.dim(` — ${ch.description}`) : ""));
      }
    } catch (e: any) {
      if (e.message?.includes("UNIQUE constraint")) {
        console.error(chalk.red(`Channel #${channelName} already exists.`));
        process.exit(1);
      }
      throw e;
    }
    closeDb();
  });

channel
  .command("list")
  .description("List all channels")
  .option("--json", "Output as JSON")
  .action((opts) => {
    const channels = listChannels();

    if (opts.json) {
      console.log(JSON.stringify(channels, null, 2));
    } else {
      if (channels.length === 0) {
        console.log(chalk.dim("No channels found."));
      } else {
        for (const ch of channels) {
          const desc = ch.description ? chalk.dim(` — ${ch.description}`) : "";
          console.log(`${chalk.magenta(`#${ch.name}`)}${desc}  ${ch.member_count} members, ${ch.message_count} messages`);
        }
      }
    }
    closeDb();
  });

channel
  .command("send")
  .description("Send a message to a channel")
  .argument("<channel>", "Channel name")
  .argument("<message>", "Message content")
  .option("--from <agent>", "Sender agent ID")
  .option("--priority <level>", "Priority: low, normal, high, urgent", "normal")
  .option("--json", "Output as JSON")
  .action((channelName, message, opts) => {
    const from = resolveIdentity(opts.from).trim();
    const channel = typeof channelName === "string" ? channelName.trim() : "";
    const content = typeof message === "string" ? message : "";

    if (!from) {
      console.error(chalk.red("Sender identity is required."));
      process.exit(1);
    }
    if (!channel) {
      console.error(chalk.red("Channel name cannot be empty."));
      process.exit(1);
    }
    if (!content.trim()) {
      console.error(chalk.red("Message content cannot be empty."));
      process.exit(1);
    }

    const ch = getChannel(channel);
    if (!ch) {
      console.error(chalk.red(`Channel #${channel} not found.`));
      process.exit(1);
    }

    const msg = sendMessage({
      from,
      to: channel,
      content,
      channel,
      session_id: `channel:${channel}`,
      priority: opts.priority,
    });

    if (opts.json) {
      console.log(JSON.stringify(msg, null, 2));
    } else {
      console.log(chalk.green(`Message sent to #${channel}`) + chalk.dim(` (id: ${msg.id})`));
    }
    closeDb();
  });

channel
  .command("read")
  .description("Read messages from a channel")
  .argument("<channel>", "Channel name")
  .option("--since <timestamp>", "Messages after this ISO timestamp")
  .option("--limit <n>", "Max messages to return", parseInt)
  .option("--json", "Output as JSON")
  .action((channelName, opts) => {
    const channel = typeof channelName === "string" ? channelName.trim() : "";
    if (!channel) {
      console.error(chalk.red("Channel name cannot be empty."));
      process.exit(1);
    }
    const messages = readMessages({
      channel,
      since: opts.since,
      limit: opts.limit,
    });

    if (opts.json) {
      console.log(JSON.stringify(messages, null, 2));
    } else {
      if (messages.length === 0) {
        console.log(chalk.dim(`No messages in #${channel}.`));
      } else {
        for (const msg of messages) {
          const time = chalk.dim(msg.created_at.slice(11, 19));
          const from = chalk.cyan(msg.from_agent);
          const priority = msg.priority !== "normal" ? chalk.red(` [${msg.priority}]`) : "";
          console.log(`${time} ${from} → ${chalk.magenta(`#${channel}`)}${priority}: ${msg.content}`);
        }
      }
    }
    closeDb();
  });

channel
  .command("join")
  .description("Join a channel")
  .argument("<channel>", "Channel name")
  .option("--from <agent>", "Agent ID")
  .option("--json", "Output as JSON")
  .action((channelName, opts) => {
    const agent = resolveIdentity(opts.from).trim();
    const channel = typeof channelName === "string" ? channelName.trim() : "";

    if (!agent) {
      console.error(chalk.red("Agent identity is required."));
      process.exit(1);
    }
    if (!channel) {
      console.error(chalk.red("Channel name cannot be empty."));
      process.exit(1);
    }

    const ok = joinChannel(channel, agent);

    if (!ok) {
      console.error(chalk.red(`Channel #${channel} not found.`));
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify({ channel, agent, joined: true }));
    } else {
      console.log(chalk.green(`${agent} joined #${channel}`));
    }
    closeDb();
  });

channel
  .command("leave")
  .description("Leave a channel")
  .argument("<channel>", "Channel name")
  .option("--from <agent>", "Agent ID")
  .option("--json", "Output as JSON")
  .action((channelName, opts) => {
    const agent = resolveIdentity(opts.from).trim();
    const channel = typeof channelName === "string" ? channelName.trim() : "";

    if (!agent) {
      console.error(chalk.red("Agent identity is required."));
      process.exit(1);
    }
    if (!channel) {
      console.error(chalk.red("Channel name cannot be empty."));
      process.exit(1);
    }

    const ok = leaveChannel(channel, agent);

    if (opts.json) {
      console.log(JSON.stringify({ channel, agent, left: ok }));
    } else {
      if (ok) {
        console.log(chalk.green(`${agent} left #${channel}`));
      } else {
        console.log(chalk.dim(`${agent} was not a member of #${channel}`));
      }
    }
    closeDb();
  });

channel
  .command("members")
  .description("List channel members")
  .argument("<channel>", "Channel name")
  .option("--json", "Output as JSON")
  .action((channelName, opts) => {
    const channel = typeof channelName === "string" ? channelName.trim() : "";
    if (!channel) {
      console.error(chalk.red("Channel name cannot be empty."));
      process.exit(1);
    }
    const members = getChannelMembers(channel);

    if (opts.json) {
      console.log(JSON.stringify(members, null, 2));
    } else {
      if (members.length === 0) {
        console.log(chalk.dim(`No members in #${channel}.`));
      } else {
        console.log(chalk.magenta(`#${channel}`) + chalk.dim(` — ${members.length} member(s)`));
        for (const m of members) {
          console.log(`  ${chalk.cyan(m.agent)} ${chalk.dim(`joined ${m.joined_at.slice(0, 10)}`)}`);
        }
      }
    }
    closeDb();
  });

// ---- mcp ----
program
  .command("mcp")
  .description("Start MCP server")
  .action(async () => {
    const { startMcpServer } = await import("../mcp/index.js");
    await startMcpServer();
  });

// ---- dashboard ----
program
  .command("dashboard")
  .description("Start web dashboard")
  .option("--port <port>", "Port to listen on", parseInt)
  .option("--host <host>", "Host to bind (default: 127.0.0.1)")
  .action(async (opts) => {
    const { startDashboardServer } = await import("../server/serve.js");
    const port = Number.isFinite(opts.port) && opts.port >= 0 && opts.port <= 65535
      ? opts.port
      : 3456;
    startDashboardServer(port, opts.host);
  });

// ---- default: TUI ----
program
  .action(() => {
    const agent = resolveIdentity();
    render(React.createElement(App, { agent }));
  });

program.parse();
