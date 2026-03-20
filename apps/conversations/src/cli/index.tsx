#!/usr/bin/env bun
import { Command } from "commander";
import chalk from "chalk";
import { render } from "ink";
import React from "react";
import { sendMessage, readMessages, readDigest, markRead, markSessionRead, markSpaceRead, getMessageById, searchMessages, markAllRead, exportMessages, deleteMessage, editMessage, pinMessage, unpinMessage, getPinnedMessages, getUnreadBlockers } from "../lib/messages.js";
import { listSessions, getSession } from "../lib/sessions.js";
import { createSpace, updateSpace, archiveSpace, unarchiveSpace, listSpaces, getSpace, joinSpace, leaveSpace, getSpaceMembers } from "../lib/spaces.js";
import { createProject, listProjects, getProject, getProjectByName, updateProject, deleteProject } from "../lib/projects.js";
import { getDb, getDbPath, closeDb } from "../lib/db.js";
import { resolveIdentity } from "../lib/identity.js";
import { heartbeat, listAgents, removePresence, renameAgent, getPresence } from "../lib/presence.js";
import { addReaction, removeReaction, getReactionSummary } from "../lib/reactions.js";
import { listHotSessions } from "../lib/hot.js";
import { getSpaceTopics, getSessionTopics, getTrendingTopics } from "../lib/topics.js";
import { getConversationSummary } from "../lib/summary.js";
import { buildGraph, getAgentNetwork, getGraphStats } from "../lib/graph.js";
import { renderContent } from "../lib/terminal-markdown.js";
import { App } from "./components/App.js";
import pkg from "../../package.json";

const program = new Command();

program
  .name("conversations")
  .description("Real-time CLI messaging for AI agents")
  .version(pkg.version);

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
  .option("--blocking", "Send as a blocking message (recipient must acknowledge)")
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
      blocking: opts.blocking,
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
  .option("--space <name>", "Filter by space")
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
  .option("--json", "Output as JSON")
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
  .option("--json", "Output as JSON")
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
  .option("--json", "Output as JSON")
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

// ---- graph ----
const graph = program.command("graph").description("Knowledge graph operations");

graph
  .command("build")
  .description("Build/rebuild knowledge graph from messages, spaces, projects")
  .option("--json", "Output as JSON")
  .action((opts) => {
    const result = buildGraph();
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(chalk.green(`Graph built: ${result.edges_created} created, ${result.edges_updated} updated`));
    }
    closeDb();
  });

graph
  .command("stats")
  .description("Show knowledge graph statistics")
  .option("--json", "Output as JSON")
  .action((opts) => {
    const stats = getGraphStats();
    if (opts.json) {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      console.log(chalk.bold(`Knowledge Graph: ${stats.total_edges} edges\n`));
      for (const [relation, count] of Object.entries(stats.by_relation)) {
        console.log(`  ${chalk.cyan(relation.padEnd(20))} ${count}`);
      }
    }
    closeDb();
  });

graph
  .command("agent")
  .description("Show an agent's communication network")
  .argument("<name>", "Agent name")
  .option("--json", "Output as JSON")
  .action((name, opts) => {
    const network = getAgentNetwork(name);
    if (opts.json) {
      console.log(JSON.stringify(network, null, 2));
    } else {
      console.log(chalk.bold(`Network for ${chalk.cyan(name)}\n`));
      if (network.communicates_with.length > 0) {
        console.log(chalk.bold("  Communicates with:"));
        for (const c of network.communicates_with) {
          console.log(`    ${chalk.cyan(c.agent.padEnd(20))} ${chalk.dim(`${c.message_count} msgs`)}`);
        }
      }
      if (network.spaces.length > 0) {
        console.log(chalk.bold("  Active spaces:"));
        for (const s of network.spaces) {
          console.log(`    ${chalk.magenta("#" + s.space.padEnd(19))} ${chalk.dim(`${s.message_count} msgs`)}`);
        }
      }
      if (network.projects.length > 0) {
        console.log(chalk.bold("  Projects:") + " " + network.projects.join(", "));
      }
    }
    closeDb();
  });

// ---- summary ----
program
  .command("summary")
  .description("Get a structured summary of a conversation")
  .argument("<target>", "Session ID or space name")
  .option("--json", "Output as JSON")
  .action((target, opts) => {
    const summary = getConversationSummary(target);
    if (!summary) {
      console.error(chalk.red(`No messages found for "${target}"`));
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(chalk.bold(`Summary: ${target}\n`));
      console.log(`  ${chalk.bold("Participants:")} ${summary.participants.join(", ")}`);
      console.log(`  ${chalk.bold("Messages:")} ${summary.message_count}`);
      console.log(`  ${chalk.bold("Date range:")} ${summary.date_range.first.slice(0, 16)} → ${summary.date_range.last.slice(0, 16)}`);
      console.log(`  ${chalk.bold("Replies:")} ${summary.activity.reply_count}  ${chalk.bold("Reactions:")} ${summary.activity.reaction_count}`);

      if (summary.topics.length > 0) {
        console.log(`\n  ${chalk.bold("Topics:")} ${summary.topics.slice(0, 5).map((t) => t.topic).join(", ")}`);
      }

      if (summary.key_messages.length > 0) {
        console.log(`\n  ${chalk.bold("Key messages:")}`);
        for (const k of summary.key_messages.slice(0, 5)) {
          console.log(`    [#${k.id}] ${chalk.cyan(k.from)} (${chalk.yellow(k.reason)}): ${k.content.slice(0, 80)}`);
        }
      }

      if (summary.unresolved_blockers.length > 0) {
        console.log(`\n  ${chalk.red.bold("Unresolved blockers:")}`);
        for (const b of summary.unresolved_blockers) {
          console.log(`    ${chalk.red("[BLOCKER]")} [#${b.id}] ${chalk.cyan(b.from)}: ${b.content.slice(0, 80)}`);
        }
      }
    }
    closeDb();
  });

// ---- topics ----
program
  .command("topics")
  .description("Extract topics from a space, session, or trending globally")
  .option("--space <name>", "Topics for a specific space")
  .option("--session <id>", "Topics for a specific session")
  .option("--hours <n>", "Trending topics in last N hours", parseInt)
  .option("--json", "Output as JSON")
  .action((opts) => {
    let topics;
    if (opts.space) {
      topics = getSpaceTopics(opts.space);
    } else if (opts.session) {
      topics = getSessionTopics(opts.session);
    } else {
      topics = getTrendingTopics({ hours: opts.hours ?? 24 });
    }

    if (opts.json) {
      console.log(JSON.stringify(topics, null, 2));
    } else {
      if (topics.length === 0) {
        console.log(chalk.dim("No topics found."));
      } else {
        const label = opts.space ? `#${opts.space}` : opts.session ? opts.session : `last ${opts.hours ?? 24}h`;
        console.log(chalk.bold(`Topics for ${label}\n`));
        for (const t of topics) {
          const bar = "█".repeat(Math.min(Math.round(t.weight * 50), 30));
          console.log(`  ${chalk.cyan(t.topic.padEnd(20))} ${chalk.dim(`×${t.count}`)}  ${chalk.green(bar)}`);
        }
      }
    }
    closeDb();
  });

// ---- hot ----
program
  .command("hot")
  .description("Show hot conversations ranked by activity")
  .option("--limit <n>", "Max results", parseInt)
  .option("--min-score <n>", "Minimum hotness score", parseInt)
  .option("--space <name>", "Filter by space")
  .option("--json", "Output as JSON")
  .action((opts) => {
    const sessions = listHotSessions({
      limit: opts.limit ?? 10,
      min_score: opts.minScore,
      space: opts.space,
    });

    if (opts.json) {
      console.log(JSON.stringify(sessions, null, 2));
    } else {
      if (sessions.length === 0) {
        console.log(chalk.dim("No hot conversations."));
      } else {
        console.log(chalk.bold("Hot Conversations\n"));
        for (const s of sessions) {
          const score = s.hotness_score > 20 ? chalk.red(`🔥 ${s.hotness_score}`) : chalk.yellow(`  ${s.hotness_score}`);
          const where = s.space ? chalk.magenta(`#${s.space}`) : chalk.cyan(s.participants.join(", "));
          const time = chalk.dim(s.last_message_at.slice(11, 16));
          const msgs = chalk.dim(`${s.message_count} msgs`);
          const agents = chalk.dim(`${s.metrics.unique_agents} agents`);
          console.log(`${score}  ${where}  ${time}  ${msgs}  ${agents}`);
        }
      }
    }
    closeDb();
  });

// ---- context ----
program
  .command("context")
  .description("One-shot session boot context for agents: online agents, unread DMs, spaces, recent activity")
  .option("--json", "Output as JSON")
  .action((opts) => {
    const agent = resolveIdentity();
    heartbeat(agent);
    const db = getDb();

    // Online agents
    const onlineAgents = listAgents({ online_only: true });

    // Unread DMs
    const unreadDMs = readMessages({ to: agent, unread_only: true, limit: 5 });

    // Spaces I'm in
    const mySpaces = db.prepare(`
      SELECT s.name, s.description,
        (SELECT COUNT(*) FROM messages m WHERE m.space = s.name AND m.read_at IS NULL) as unread
      FROM spaces s
      JOIN space_members sm ON sm.space = s.name
      WHERE sm.agent = ?
      ORDER BY s.name
    `).all(agent) as { name: string; description: string | null; unread: number }[];

    // Recent DMs (last 3 messages to me)
    const recentDMs = readMessages({ to: agent, limit: 3 });

    const context = { agent, online_agents: onlineAgents, unread_dms: unreadDMs, spaces: mySpaces, recent_dms: recentDMs };

    if (opts.json) {
      console.log(JSON.stringify(context, null, 2));
    } else {
      console.log(chalk.bold(`Context for ${chalk.cyan(agent)}\n`));

      // Online agents
      if (onlineAgents.length > 0) {
        const names = onlineAgents.map((a) => chalk.green(a.agent)).join(", ");
        console.log(`${chalk.bold("Online agents:")} ${names}`);
      } else {
        console.log(`${chalk.bold("Online agents:")} ${chalk.dim("none")}`);
      }

      // Unread DMs
      if (unreadDMs.length > 0) {
        console.log(`${chalk.bold("Unread DMs:")} ${chalk.yellow(unreadDMs.length + " message(s)")}`);
        for (const msg of unreadDMs.slice(0, 3)) {
          console.log(`  ${chalk.dim(msg.created_at.slice(11, 16))} ${chalk.cyan(msg.from_agent)}: ${msg.content.slice(0, 80)}`);
        }
      } else {
        console.log(`${chalk.bold("Unread DMs:")} ${chalk.dim("none")}`);
      }

      // Spaces
      if (mySpaces.length > 0) {
        console.log(`${chalk.bold("My spaces:")}`);
        for (const sp of mySpaces) {
          const unread = sp.unread > 0 ? chalk.yellow(` (${sp.unread} unread)`) : "";
          console.log(`  ${chalk.magenta("#" + sp.name)}${unread}`);
        }
      } else {
        console.log(`${chalk.bold("My spaces:")} ${chalk.dim("none")}`);
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
  .option("--json", "Output as JSON")
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
    const totalSpaces = (db.prepare("SELECT COUNT(*) as count FROM spaces").get() as { count: number }).count;
    const totalProjects = (db.prepare("SELECT COUNT(*) as count FROM projects").get() as { count: number }).count;

    const stats = {
      db_path: dbPath,
      total_messages: totalMessages,
      total_sessions: totalSessions,
      total_spaces: totalSpaces,
      total_projects: totalProjects,
      unread_messages: totalUnread,
    };

    if (opts.json) {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      console.log(chalk.bold("Conversations Status"));
      console.log(`  DB Path:    ${stats.db_path}`);
      console.log(`  Messages:   ${stats.total_messages}`);
      console.log(`  Sessions:   ${stats.total_sessions}`);
      console.log(`  Spaces:     ${stats.total_spaces}`);
      console.log(`  Projects:   ${stats.total_projects}`);
      console.log(`  Unread:     ${stats.unread_messages}`);
    }
    closeDb();
  });

// ---- doctor ----
program
  .command("doctor")
  .description("Check conversations setup and health")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    const checks: { name: string; ok: boolean; message: string }[] = [];

    // 1. DB accessible
    try {
      const db = getDb();
      db.prepare("SELECT 1").get();
      const dbPath = getDbPath();
      checks.push({ name: "Database", ok: true, message: `OK — ${dbPath}` });
    } catch (e: any) {
      checks.push({ name: "Database", ok: false, message: `Cannot open DB: ${e.message}` });
    }

    // 2. WAL mode
    try {
      const db = getDb();
      const mode = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
      const isWal = mode.journal_mode === "wal";
      checks.push({ name: "WAL mode", ok: isWal, message: isWal ? "OK — WAL mode enabled" : `WARNING — journal_mode is ${mode.journal_mode}` });
    } catch {
      checks.push({ name: "WAL mode", ok: false, message: "Could not check WAL mode" });
    }

    // 3. MCP binary on PATH
    try {
      const proc = Bun.spawn(["which", "conversations-mcp"], { stdout: "pipe", stderr: "pipe" });
      const exit = await proc.exited;
      const path = await new Response(proc.stdout).text();
      checks.push({ name: "MCP binary", ok: exit === 0, message: exit === 0 ? `OK — ${path.trim()}` : "conversations-mcp not found in PATH — run: bun install -g @hasna/conversations" });
    } catch {
      checks.push({ name: "MCP binary", ok: false, message: "Could not check MCP binary" });
    }

    // 4. npm version check
    try {
      const current = pkg.version;
      const res = await fetch("https://registry.npmjs.org/@hasna/conversations/latest");
      const data = await res.json() as { version: string };
      const latest = data.version;
      const upToDate = current === latest;
      checks.push({ name: "npm version", ok: upToDate, message: upToDate ? `OK — v${current} (latest)` : `Update available: v${current} → v${latest} — run: bun install -g @hasna/conversations@latest` });
    } catch {
      checks.push({ name: "npm version", ok: true, message: "Could not check npm registry (offline?)" });
    }

    // 5. Webhook config validity
    const { homedir } = await import("os");
    const { existsSync } = await import("fs");
    const { join } = await import("path");
    const configPath = process.env.CONVERSATIONS_CONFIG_PATH ?? join(homedir(), ".conversations", "config.json");
    if (existsSync(configPath)) {
      try {
        const { readFileSync } = await import("fs");
        JSON.parse(readFileSync(configPath, "utf8"));
        checks.push({ name: "Webhook config", ok: true, message: `OK — ${configPath}` });
      } catch (e: any) {
        checks.push({ name: "Webhook config", ok: false, message: `Invalid JSON at ${configPath}: ${e.message}` });
      }
    } else {
      checks.push({ name: "Webhook config", ok: true, message: "No webhook config (optional)" });
    }

    closeDb();

    const allOk = checks.every((c) => c.ok);

    if (opts.json) {
      console.log(JSON.stringify({ ok: allOk, checks }, null, 2));
    } else {
      console.log(chalk.bold("Conversations Doctor\n"));
      for (const check of checks) {
        const icon = check.ok ? chalk.green("✓") : chalk.red("✗");
        const label = chalk.bold(check.name.padEnd(16));
        console.log(`  ${icon}  ${label}  ${check.message}`);
      }
      console.log();
      if (allOk) {
        console.log(chalk.green("All checks passed."));
      } else {
        const failed = checks.filter((c) => !c.ok).length;
        console.log(chalk.red(`${failed} check(s) failed.`));
        process.exit(1);
      }
    }
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

// ---- space ----
const space = program
  .command("space")
  .description("Manage spaces");

space
  .command("create")
  .description("Create a new space")
  .argument("<name>", "Space name")
  .option("--description <text>", "Space description")
  .option("--parent <name>", "Parent space name (for nesting)")
  .option("--project <id>", "Project ID to associate with")
  .option("--from <agent>", "Creator agent ID")
  .option("--json", "Output as JSON")
  .action((name, opts) => {
    const agent = resolveIdentity(opts.from).trim();
    const spaceName = typeof name === "string" ? name.trim() : "";
    if (!agent) {
      console.error(chalk.red("Creator identity is required."));
      process.exit(1);
    }
    if (!spaceName) {
      console.error(chalk.red("Space name cannot be empty."));
      process.exit(1);
    }
    try {
      const description = typeof opts.description === "string" && opts.description.trim()
        ? opts.description.trim()
        : undefined;
      const sp = createSpace(spaceName, agent, {
        description,
        parent_id: opts.parent,
        project_id: opts.project,
      });
      if (opts.json) {
        console.log(JSON.stringify(sp, null, 2));
      } else {
        console.log(chalk.green(`Space #${sp.name} created`) + (sp.description ? chalk.dim(` — ${sp.description}`) : ""));
      }
    } catch (e: any) {
      if (e.message?.includes("UNIQUE constraint")) {
        console.error(chalk.red(`Space #${spaceName} already exists.`));
        process.exit(1);
      }
      console.error(chalk.red(e.message));
      process.exit(1);
    }
    closeDb();
  });

space
  .command("list")
  .description("List all spaces")
  .option("--project <id>", "Filter by project ID")
  .option("--parent <name>", "Filter by parent space name")
  .option("--top-level", "Show only top-level spaces")
  .option("--archived", "Include archived spaces")
  .option("--json", "Output as JSON")
  .action((opts) => {
    const listOpts: { project_id?: string; parent_id?: string | null; include_archived?: boolean } = {};
    if (opts.project) listOpts.project_id = opts.project;
    if (opts.topLevel) {
      listOpts.parent_id = null;
    } else if (opts.parent) {
      listOpts.parent_id = opts.parent;
    }
    if (opts.archived) listOpts.include_archived = true;

    const spaces = listSpaces(listOpts);

    if (opts.json) {
      console.log(JSON.stringify(spaces, null, 2));
    } else {
      if (spaces.length === 0) {
        console.log(chalk.dim("No spaces found."));
      } else {
        for (const sp of spaces) {
          const desc = sp.description ? chalk.dim(` — ${sp.description}`) : "";
          const parent = sp.parent_id ? chalk.dim(` (child of ${sp.parent_id})`) : "";
          const archived = sp.archived_at ? chalk.yellow(" [archived]") : "";
          console.log(`${chalk.magenta(`#${sp.name}`)}${desc}${parent}${archived}  ${sp.member_count} members, ${sp.message_count} messages`);
        }
      }
    }
    closeDb();
  });

space
  .command("update")
  .description("Update a space")
  .argument("<name>", "Space name")
  .option("--description <text>", "New description")
  .option("--parent <name>", "New parent space name")
  .option("--project <id>", "New project ID")
  .option("--json", "Output as JSON")
  .action((name, opts) => {
    const spaceName = typeof name === "string" ? name.trim() : "";
    if (!spaceName) {
      console.error(chalk.red("Space name cannot be empty."));
      process.exit(1);
    }

    const updates: { description?: string; parent_id?: string | null; project_id?: string | null } = {};
    if (opts.description !== undefined) updates.description = opts.description;
    if (opts.parent !== undefined) updates.parent_id = opts.parent || null;
    if (opts.project !== undefined) updates.project_id = opts.project || null;

    try {
      const sp = updateSpace(spaceName, updates);
      if (opts.json) {
        console.log(JSON.stringify(sp, null, 2));
      } else {
        console.log(chalk.green(`Space #${sp.name} updated.`));
      }
    } catch (e: any) {
      console.error(chalk.red(e.message));
      process.exit(1);
    }
    closeDb();
  });

space
  .command("archive")
  .description("Archive a space")
  .argument("<name>", "Space name")
  .option("--json", "Output as JSON")
  .action((name, opts) => {
    const spaceName = typeof name === "string" ? name.trim() : "";
    if (!spaceName) {
      console.error(chalk.red("Space name cannot be empty."));
      process.exit(1);
    }

    try {
      const sp = archiveSpace(spaceName);
      if (opts.json) {
        console.log(JSON.stringify(sp, null, 2));
      } else {
        console.log(chalk.green(`Space #${sp.name} archived.`));
      }
    } catch (e: any) {
      console.error(chalk.red(e.message));
      process.exit(1);
    }
    closeDb();
  });

space
  .command("unarchive")
  .description("Unarchive a space")
  .argument("<name>", "Space name")
  .option("--json", "Output as JSON")
  .action((name, opts) => {
    const spaceName = typeof name === "string" ? name.trim() : "";
    if (!spaceName) {
      console.error(chalk.red("Space name cannot be empty."));
      process.exit(1);
    }

    try {
      const sp = unarchiveSpace(spaceName);
      if (opts.json) {
        console.log(JSON.stringify(sp, null, 2));
      } else {
        console.log(chalk.green(`Space #${sp.name} unarchived.`));
      }
    } catch (e: any) {
      console.error(chalk.red(e.message));
      process.exit(1);
    }
    closeDb();
  });

space
  .command("send")
  .description("Send a message to a space")
  .argument("<space>", "Space name")
  .argument("<message>", "Message content")
  .option("--from <agent>", "Sender agent ID")
  .option("--priority <level>", "Priority: low, normal, high, urgent", "normal")
  .option("--json", "Output as JSON")
  .action((spaceName, message, opts) => {
    const from = resolveIdentity(opts.from).trim();
    const spaceArg = typeof spaceName === "string" ? spaceName.trim() : "";
    const content = typeof message === "string" ? message : "";

    if (!from) {
      console.error(chalk.red("Sender identity is required."));
      process.exit(1);
    }
    if (!spaceArg) {
      console.error(chalk.red("Space name cannot be empty."));
      process.exit(1);
    }
    if (!content.trim()) {
      console.error(chalk.red("Message content cannot be empty."));
      process.exit(1);
    }

    const sp = getSpace(spaceArg);
    if (!sp) {
      console.error(chalk.red(`Space #${spaceArg} not found.`));
      process.exit(1);
    }

    const msg = sendMessage({
      from,
      to: spaceArg,
      content,
      space: spaceArg,
      session_id: `space:${spaceArg}`,
      priority: opts.priority,
    });

    if (opts.json) {
      console.log(JSON.stringify(msg, null, 2));
    } else {
      console.log(chalk.green(`Message sent to #${spaceArg}`) + chalk.dim(` (id: ${msg.id})`));
    }
    closeDb();
  });

space
  .command("read")
  .description("Read messages from a space")
  .argument("<space>", "Space name")
  .option("--since <timestamp>", "Messages after this ISO timestamp")
  .option("--limit <n>", "Max messages to return", parseInt)
  .option("--json", "Output as JSON")
  .action((spaceName, opts) => {
    const spaceArg = typeof spaceName === "string" ? spaceName.trim() : "";
    if (!spaceArg) {
      console.error(chalk.red("Space name cannot be empty."));
      process.exit(1);
    }
    const messages = readMessages({
      space: spaceArg,
      since: opts.since,
      limit: opts.limit,
    });

    if (opts.json) {
      console.log(JSON.stringify(messages, null, 2));
    } else {
      if (messages.length === 0) {
        console.log(chalk.dim(`No messages in #${spaceArg}.`));
      } else {
        for (const msg of messages) {
          const time = chalk.dim(msg.created_at.slice(11, 19));
          const from = chalk.cyan(msg.from_agent);
          const priority = msg.priority !== "normal" ? chalk.red(` [${msg.priority}]`) : "";
          console.log(`${time} ${from} → ${chalk.magenta(`#${spaceArg}`)}${priority}`);
          const rendered = renderContent(msg.content);
          const indented = rendered.split("\n").map((l: string) => "  " + l).join("\n");
          console.log(indented);
        }
      }
    }
    closeDb();
  });

space
  .command("join")
  .description("Join a space")
  .argument("<space>", "Space name")
  .option("--from <agent>", "Agent ID")
  .option("--json", "Output as JSON")
  .action((spaceName, opts) => {
    const agent = resolveIdentity(opts.from).trim();
    const spaceArg = typeof spaceName === "string" ? spaceName.trim() : "";

    if (!agent) {
      console.error(chalk.red("Agent identity is required."));
      process.exit(1);
    }
    if (!spaceArg) {
      console.error(chalk.red("Space name cannot be empty."));
      process.exit(1);
    }

    const ok = joinSpace(spaceArg, agent);

    if (!ok) {
      console.error(chalk.red(`Space #${spaceArg} not found.`));
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify({ space: spaceArg, agent, joined: true }));
    } else {
      console.log(chalk.green(`${agent} joined #${spaceArg}`));
    }
    closeDb();
  });

space
  .command("leave")
  .description("Leave a space")
  .argument("<space>", "Space name")
  .option("--from <agent>", "Agent ID")
  .option("--json", "Output as JSON")
  .action((spaceName, opts) => {
    const agent = resolveIdentity(opts.from).trim();
    const spaceArg = typeof spaceName === "string" ? spaceName.trim() : "";

    if (!agent) {
      console.error(chalk.red("Agent identity is required."));
      process.exit(1);
    }
    if (!spaceArg) {
      console.error(chalk.red("Space name cannot be empty."));
      process.exit(1);
    }

    const ok = leaveSpace(spaceArg, agent);

    if (opts.json) {
      console.log(JSON.stringify({ space: spaceArg, agent, left: ok }));
    } else {
      if (ok) {
        console.log(chalk.green(`${agent} left #${spaceArg}`));
      } else {
        console.log(chalk.dim(`${agent} was not a member of #${spaceArg}`));
      }
    }
    closeDb();
  });

space
  .command("members")
  .description("List space members")
  .argument("<space>", "Space name")
  .option("--json", "Output as JSON")
  .action((spaceName, opts) => {
    const spaceArg = typeof spaceName === "string" ? spaceName.trim() : "";
    if (!spaceArg) {
      console.error(chalk.red("Space name cannot be empty."));
      process.exit(1);
    }
    const members = getSpaceMembers(spaceArg);

    if (opts.json) {
      console.log(JSON.stringify(members, null, 2));
    } else {
      if (members.length === 0) {
        console.log(chalk.dim(`No members in #${spaceArg}.`));
      } else {
        console.log(chalk.magenta(`#${spaceArg}`) + chalk.dim(` — ${members.length} member(s)`));
        for (const m of members) {
          console.log(`  ${chalk.cyan(m.agent)} ${chalk.dim(`joined ${m.joined_at.slice(0, 10)}`)}`);
        }
      }
    }
    closeDb();
  });

// ---- project ----
const project = program
  .command("project")
  .description("Manage projects");

project
  .command("create")
  .description("Create a new project")
  .argument("<name>", "Project name")
  .option("--description <text>", "Project description")
  .option("--path <path>", "Project path on disk")
  .option("--repository <url>", "Repository URL")
  .option("--tags <json>", "JSON array of tags")
  .option("--from <agent>", "Creator agent ID")
  .option("--json", "Output as JSON")
  .action((name, opts) => {
    const agent = resolveIdentity(opts.from).trim();
    const projectName = typeof name === "string" ? name.trim() : "";
    if (!agent) {
      console.error(chalk.red("Creator identity is required."));
      process.exit(1);
    }
    if (!projectName) {
      console.error(chalk.red("Project name cannot be empty."));
      process.exit(1);
    }

    let tags: string[] | undefined;
    if (opts.tags) {
      try {
        tags = JSON.parse(opts.tags);
      } catch {
        console.error(chalk.red("Invalid --tags JSON. Expected array of strings."));
        process.exit(1);
      }
    }

    try {
      const p = createProject({
        name: projectName,
        created_by: agent,
        description: opts.description,
        path: opts.path,
        repository: opts.repository,
        tags,
      });
      if (opts.json) {
        console.log(JSON.stringify(p, null, 2));
      } else {
        console.log(chalk.green(`Project "${p.name}" created`) + chalk.dim(` (id: ${p.id})`));
      }
    } catch (e: any) {
      if (e.message?.includes("UNIQUE constraint")) {
        console.error(chalk.red(`Project "${projectName}" already exists.`));
        process.exit(1);
      }
      console.error(chalk.red(e.message));
      process.exit(1);
    }
    closeDb();
  });

project
  .command("list")
  .description("List all projects")
  .option("--status <status>", "Filter by status (active/archived)")
  .option("--json", "Output as JSON")
  .action((opts) => {
    const status = opts.status === "active" || opts.status === "archived" ? opts.status : undefined;
    const projects = listProjects(status ? { status } : undefined);

    if (opts.json) {
      console.log(JSON.stringify(projects, null, 2));
    } else {
      if (projects.length === 0) {
        console.log(chalk.dim("No projects found."));
      } else {
        for (const p of projects) {
          const desc = p.description ? chalk.dim(` — ${p.description}`) : "";
          const statusBadge = p.status === "archived" ? chalk.yellow(" [archived]") : "";
          console.log(`${chalk.bold(p.name)}${desc}${statusBadge}  ${p.space_count} spaces`);
        }
      }
    }
    closeDb();
  });

project
  .command("get")
  .description("Get project details")
  .argument("<id-or-name>", "Project ID or name")
  .option("--json", "Output as JSON")
  .action((idOrName, opts) => {
    let p = getProject(idOrName);
    if (!p) p = getProjectByName(idOrName);

    if (!p) {
      console.error(chalk.red(`Project "${idOrName}" not found.`));
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(p, null, 2));
    } else {
      console.log(chalk.bold(p.name));
      if (p.description) console.log(`  Description: ${p.description}`);
      if (p.path) console.log(`  Path: ${p.path}`);
      if (p.repository) console.log(`  Repository: ${p.repository}`);
      console.log(`  Status: ${p.status}`);
      console.log(`  Spaces: ${p.space_count}`);
      if (p.tags.length > 0) console.log(`  Tags: ${p.tags.join(", ")}`);
      console.log(`  Created by: ${p.created_by} on ${p.created_at.slice(0, 10)}`);
    }
    closeDb();
  });

project
  .command("update")
  .description("Update a project")
  .argument("<id>", "Project ID")
  .option("--name <name>", "New name")
  .option("--description <text>", "New description")
  .option("--path <path>", "New path")
  .option("--status <status>", "New status (active/archived)")
  .option("--repository <url>", "New repository URL")
  .option("--tags <json>", "New tags (JSON array)")
  .option("--json", "Output as JSON")
  .action((id, opts) => {
    const updates: Record<string, unknown> = {};
    if (opts.name) updates.name = opts.name;
    if (opts.description) updates.description = opts.description;
    if (opts.path) updates.path = opts.path;
    if (opts.status) updates.status = opts.status;
    if (opts.repository) updates.repository = opts.repository;
    if (opts.tags) {
      try {
        updates.tags = JSON.parse(opts.tags);
      } catch {
        console.error(chalk.red("Invalid --tags JSON."));
        process.exit(1);
      }
    }

    try {
      const p = updateProject(id, updates as any);
      if (opts.json) {
        console.log(JSON.stringify(p, null, 2));
      } else {
        console.log(chalk.green(`Project "${p.name}" updated.`));
      }
    } catch (e: any) {
      console.error(chalk.red(e.message));
      process.exit(1);
    }
    closeDb();
  });

project
  .command("delete")
  .description("Delete a project")
  .argument("<id>", "Project ID")
  .option("--json", "Output as JSON")
  .action((id, opts) => {
    try {
      const deleted = deleteProject(id);
      if (!deleted) {
        console.error(chalk.red(`Project "${id}" not found.`));
        process.exit(1);
      }
      if (opts.json) {
        console.log(JSON.stringify({ id, deleted: true }));
      } else {
        console.log(chalk.green(`Project deleted.`));
      }
    } catch (e: any) {
      console.error(chalk.red(e.message));
      process.exit(1);
    }
    closeDb();
  });

// ---- delete ----
program
  .command("delete")
  .description("Delete a message (only sender can delete)")
  .argument("<id>", "Message ID", parseInt)
  .option("--from <agent>", "Sender agent ID")
  .option("--json", "Output as JSON")
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

// ---- edit ----
program
  .command("edit")
  .description("Edit a message (only sender can edit)")
  .argument("<id>", "Message ID", parseInt)
  .argument("<new-content>", "New message content")
  .option("--from <agent>", "Sender agent ID")
  .option("--json", "Output as JSON")
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

// ---- pin ----
program
  .command("pin")
  .description("Pin a message")
  .argument("<id>", "Message ID", parseInt)
  .option("--json", "Output as JSON")
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
  .option("--json", "Output as JSON")
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
  .option("--json", "Output as JSON")
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

// ---- react ----
program
  .command("react")
  .description("Add an emoji reaction to a message")
  .argument("<id>", "Message ID", parseInt)
  .argument("<emoji>", "Emoji to react with")
  .option("--from <agent>", "Agent identity override")
  .option("--json", "Output as JSON")
  .action((id, emoji, opts) => {
    const agent = resolveIdentity(opts.from);
    const reaction = addReaction(id, agent, emoji);
    if (opts.json) {
      console.log(JSON.stringify(reaction, null, 2));
    } else {
      console.log(chalk.green(`${emoji} reaction added to message #${id}`));
    }
    closeDb();
  });

// ---- unreact ----
program
  .command("unreact")
  .description("Remove an emoji reaction from a message")
  .argument("<id>", "Message ID", parseInt)
  .argument("<emoji>", "Emoji to remove")
  .option("--from <agent>", "Agent identity override")
  .option("--json", "Output as JSON")
  .action((id, emoji, opts) => {
    const agent = resolveIdentity(opts.from);
    const removed = removeReaction(id, agent, emoji);
    if (opts.json) {
      console.log(JSON.stringify({ removed }, null, 2));
    } else {
      if (removed) {
        console.log(chalk.green(`${emoji} reaction removed from message #${id}`));
      } else {
        console.log(chalk.dim(`No ${emoji} reaction found on message #${id}`));
      }
    }
    closeDb();
  });

// ---- reactions ----
program
  .command("reactions")
  .description("Show emoji reactions on a message")
  .argument("<id>", "Message ID", parseInt)
  .option("--json", "Output as JSON")
  .action((id, opts) => {
    const summary = getReactionSummary(id);
    if (opts.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      if (summary.length === 0) {
        console.log(chalk.dim(`No reactions on message #${id}`));
      } else {
        const parts = summary.map((r) => `${r.emoji} ${r.count}`).join("  ");
        console.log(`Message #${id}: ${parts}`);
      }
    }
    closeDb();
  });

// ---- agents ----
const agents = program
  .command("agents")
  .description("Manage agents");

agents
  .command("list")
  .description("List all agents with their presence status")
  .option("--online", "Only show online agents")
  .option("--json", "Output as JSON")
  .action((opts) => {
    const agent = resolveIdentity();
    heartbeat(agent);

    const agentsList = listAgents({ online_only: opts.online });

    if (opts.json) {
      console.log(JSON.stringify(agentsList, null, 2));
    } else {
      if (agentsList.length === 0) {
        console.log(chalk.dim("No agents found."));
      } else {
        for (const a of agentsList) {
          const status = a.online ? chalk.green("online") : chalk.dim("offline");
          const lastSeen = chalk.dim(a.last_seen_at.slice(0, 19));
          const agentName = a.agent === agent ? chalk.cyan(`${a.agent} (you)`) : chalk.cyan(a.agent);
          console.log(`  ${agentName}  ${status}  ${chalk.dim(a.status)}  ${lastSeen}`);
        }
      }
    }
    closeDb();
  });

agents
  .command("remove")
  .description("Remove an agent from the presence list")
  .argument("<name>", "Agent name to remove")
  .option("--json", "Output as JSON")
  .action((name, opts) => {
    const agentName = typeof name === "string" ? name.trim() : "";
    if (!agentName) {
      console.error(chalk.red("Agent name cannot be empty."));
      process.exit(1);
    }

    const removed = removePresence(agentName);

    if (opts.json) {
      console.log(JSON.stringify({ agent: agentName, removed }));
    } else {
      if (removed) {
        console.log(chalk.green(`Agent "${agentName}" removed.`));
      } else {
        console.error(chalk.red(`Agent "${agentName}" not found.`));
        process.exit(1);
      }
    }
    closeDb();
  });

agents
  .command("rename")
  .description("Rename an agent in the presence list")
  .argument("<old-name>", "Current agent name")
  .argument("<new-name>", "New agent name")
  .option("--json", "Output as JSON")
  .action((oldName, newName, opts) => {
    const old = typeof oldName === "string" ? oldName.trim() : "";
    const renamed = typeof newName === "string" ? newName.trim() : "";

    if (!old || !renamed) {
      console.error(chalk.red("Both old and new names are required."));
      process.exit(1);
    }

    try {
      const ok = renameAgent(old, renamed);
      if (!ok) {
        console.error(chalk.red(`Agent "${old}" not found.`));
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify({ old_name: old, new_name: renamed, renamed: true }));
      } else {
        console.log(chalk.green(`Agent "${old}" renamed to "${renamed}".`));
      }
    } catch (e: any) {
      console.error(chalk.red(e.message));
      process.exit(1);
    }
    closeDb();
  });

// ---- whoami ----
program
  .command("whoami")
  .description("Show current agent identity and online status")
  .option("--from <agent>", "Explicit agent identity")
  .action((opts) => {
    const envValue = process.env.CONVERSATIONS_AGENT_ID?.trim();
    const agent = resolveIdentity(opts.from);

    let source: string;
    if (opts.from) {
      source = "explicit (--from flag)";
    } else if (envValue) {
      source = "env var (CONVERSATIONS_AGENT_ID)";
    } else {
      const { join } = require("path");
      const { homedir } = require("os");
      const agentIdFile = join(homedir(), ".conversations", "agent-id");
      source = `auto-generated (${agentIdFile})`;
    }

    const presence = getPresence(agent);
    let onlineStatus: string;
    if (presence && presence.online) {
      const lastSeenMs = new Date(presence.last_seen_at + "Z").getTime();
      const agoMs = Date.now() - lastSeenMs;
      const agoSec = Math.floor(agoMs / 1000);
      const agoStr = agoSec < 60 ? `${agoSec}s ago` : `${Math.floor(agoSec / 60)}m ago`;
      onlineStatus = chalk.green(`yes`) + chalk.dim(` (last seen ${agoStr})`);
    } else if (presence) {
      onlineStatus = chalk.red("no") + chalk.dim(` (last seen ${presence.last_seen_at})`);
    } else {
      onlineStatus = chalk.red("no") + chalk.dim(" (no presence record)");
    }

    console.log(`  ${chalk.bold("Agent:")}  ${chalk.cyan(agent)}`);
    console.log(`  ${chalk.bold("Source:")} ${source}`);
    console.log(`  ${chalk.bold("Online:")} ${onlineStatus}`);
    closeDb();
  });

// ---- blockers ----
program
  .command("blockers")
  .description("Check for unread blocking messages")
  .option("--from <agent>", "Agent to check blockers for")
  .option("--json", "Output as JSON")
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

    const { startPolling } = require("../lib/poll.js");
    const { renderContent } = require("../lib/terminal-markdown.js");

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

    const renderMessage = (msg: import("../types.js").Message) => {
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
      const content = renderContent(msg.content) as string;
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
      const spaceRecent: import("../types.js").Message[] = [];
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

    const onNewMessages = (messages: import("../types.js").Message[]) => {
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
  .option("--open", "Auto-open dashboard in browser")
  .action(async (opts) => {
    const { startDashboardServer } = await import("../server/serve.js");
    const port = Number.isFinite(opts.port) && opts.port >= 0 && opts.port <= 65535
      ? opts.port
      : 0;
    const server = startDashboardServer(port, opts.host);
    if (opts.open) {
      const { exec } = require("child_process");
      exec(`open http://localhost:${server.port}`);
    }
  });

// ---- default: TUI ----
program
  .action(() => {
    if (!process.stdin.isTTY) {
      console.error(chalk.red("Interactive mode requires a TTY terminal."));
      console.error(chalk.dim("Use subcommands (send, read, sessions, etc.) for non-interactive use."));
      process.exit(1);
    }
    const agent = resolveIdentity();
    render(React.createElement(App, { agent }));
  });

program.parse();
