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
    const from = resolveIdentity(opts.from);
    const metadata = opts.metadata ? JSON.parse(opts.metadata) : undefined;

    const msg = sendMessage({
      from,
      to: opts.to,
      content: message,
      session_id: opts.session,
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

    if (opts.markRead && opts.to) {
      const ids = messages.filter((m) => m.to_agent === opts.to && !m.read_at).map((m) => m.id);
      if (ids.length > 0) markRead(ids, opts.to);
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

    const from = resolveIdentity(opts.from);
    const msg = sendMessage({
      from,
      to: original.from_agent,
      content: message,
      session_id: original.session_id,
      priority: opts.priority,
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
    const agent = resolveIdentity(opts.from);
    try {
      const ch = createChannel(name, agent, opts.description);
      if (opts.json) {
        console.log(JSON.stringify(ch, null, 2));
      } else {
        console.log(chalk.green(`Channel #${ch.name} created`) + (ch.description ? chalk.dim(` — ${ch.description}`) : ""));
      }
    } catch (e: any) {
      if (e.message?.includes("UNIQUE constraint")) {
        console.error(chalk.red(`Channel #${name} already exists.`));
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
    const from = resolveIdentity(opts.from);

    const ch = getChannel(channelName);
    if (!ch) {
      console.error(chalk.red(`Channel #${channelName} not found.`));
      process.exit(1);
    }

    const msg = sendMessage({
      from,
      to: channelName,
      content: message,
      channel: channelName,
      session_id: `channel:${channelName}`,
      priority: opts.priority,
    });

    if (opts.json) {
      console.log(JSON.stringify(msg, null, 2));
    } else {
      console.log(chalk.green(`Message sent to #${channelName}`) + chalk.dim(` (id: ${msg.id})`));
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
    const messages = readMessages({
      channel: channelName,
      since: opts.since,
      limit: opts.limit,
    });

    if (opts.json) {
      console.log(JSON.stringify(messages, null, 2));
    } else {
      if (messages.length === 0) {
        console.log(chalk.dim(`No messages in #${channelName}.`));
      } else {
        for (const msg of messages) {
          const time = chalk.dim(msg.created_at.slice(11, 19));
          const from = chalk.cyan(msg.from_agent);
          const priority = msg.priority !== "normal" ? chalk.red(` [${msg.priority}]`) : "";
          console.log(`${time} ${from} → ${chalk.magenta(`#${channelName}`)}${priority}: ${msg.content}`);
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
    const agent = resolveIdentity(opts.from);
    const ok = joinChannel(channelName, agent);

    if (!ok) {
      console.error(chalk.red(`Channel #${channelName} not found.`));
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify({ channel: channelName, agent, joined: true }));
    } else {
      console.log(chalk.green(`${agent} joined #${channelName}`));
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
    const agent = resolveIdentity(opts.from);
    const ok = leaveChannel(channelName, agent);

    if (opts.json) {
      console.log(JSON.stringify({ channel: channelName, agent, left: ok }));
    } else {
      if (ok) {
        console.log(chalk.green(`${agent} left #${channelName}`));
      } else {
        console.log(chalk.dim(`${agent} was not a member of #${channelName}`));
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
    const members = getChannelMembers(channelName);

    if (opts.json) {
      console.log(JSON.stringify(members, null, 2));
    } else {
      if (members.length === 0) {
        console.log(chalk.dim(`No members in #${channelName}.`));
      } else {
        console.log(chalk.magenta(`#${channelName}`) + chalk.dim(` — ${members.length} member(s)`));
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
  .action(async (opts) => {
    const { startDashboardServer } = await import("../server/serve.js");
    startDashboardServer(opts.port || 3456);
  });

// ---- default: TUI ----
program
  .action(() => {
    const agent = resolveIdentity();
    render(React.createElement(App, { agent }));
  });

program.parse();
