#!/usr/bin/env bun
import { Command } from "commander";
import chalk from "chalk";
import { render } from "ink";
import React from "react";
import { sendMessage, readMessages, markRead, markSessionRead, getMessageById } from "../lib/messages.js";
import { listSessions, getSession } from "../lib/sessions.js";
import { getDb, getDbPath, closeDb } from "../lib/db.js";
import { resolveIdentity } from "../lib/identity.js";
import { App } from "./components/App.js";

const program = new Command();

program
  .name("convo")
  .description("Real-time CLI messaging for AI agents")
  .version("0.0.1");

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
          const to = chalk.yellow(msg.to_agent);
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
  .option("--agent <id>", "Agent marking messages as read")
  .option("--json", "Output as JSON")
  .action((ids, opts) => {
    const agent = resolveIdentity(opts.agent);
    let count = 0;

    if (opts.session) {
      count = markSessionRead(opts.session, agent);
    } else if (ids.length > 0) {
      count = markRead(ids.map(Number), agent);
    } else {
      console.error(chalk.red("Provide message IDs or --session flag."));
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

    const stats = {
      db_path: dbPath,
      total_messages: totalMessages,
      total_sessions: totalSessions,
      unread_messages: totalUnread,
    };

    if (opts.json) {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      console.log(chalk.bold("Conversations Status"));
      console.log(`  DB Path:    ${stats.db_path}`);
      console.log(`  Messages:   ${stats.total_messages}`);
      console.log(`  Sessions:   ${stats.total_sessions}`);
      console.log(`  Unread:     ${stats.unread_messages}`);
    }
    closeDb();
  });

// ---- mcp ----
program
  .command("mcp")
  .description("Start MCP server")
  .action(async () => {
    // Dynamic import to avoid loading MCP deps for other commands
    const { startMcpServer } = await import("../mcp/index.js");
    await startMcpServer();
  });

// ---- default: TUI ----
program
  .action(() => {
    const agent = resolveIdentity();
    render(React.createElement(App, { agent }));
  });

program.parse();
