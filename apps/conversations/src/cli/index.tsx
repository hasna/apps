#!/usr/bin/env bun
import { Command } from "commander";
import chalk from "chalk";
import { render } from "ink";
import React from "react";
import { sendMessage, readMessages, markRead, markSessionRead, markSpaceRead, getMessageById, searchMessages, markAllRead, exportMessages, deleteMessage, editMessage, pinMessage, unpinMessage, getPinnedMessages, getUnreadBlockers } from "../lib/messages.js";
import { listSessions, getSession } from "../lib/sessions.js";
import { createSpace, updateSpace, archiveSpace, unarchiveSpace, listSpaces, getSpace, joinSpace, leaveSpace, getSpaceMembers } from "../lib/spaces.js";
import { createProject, listProjects, getProject, getProjectByName, updateProject, deleteProject } from "../lib/projects.js";
import { getDb, getDbPath, closeDb } from "../lib/db.js";
import { resolveIdentity } from "../lib/identity.js";
import { heartbeat, listAgents, removePresence, renameAgent } from "../lib/presence.js";
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
          console.log(`${time} ${from} → ${to}${priority}${unread}: ${msg.content}`);
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
          console.log(`${time} ${from} → ${chalk.magenta(`#${spaceArg}`)}${priority}: ${msg.content}`);
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
      : 0;
    startDashboardServer(port, opts.host);
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
