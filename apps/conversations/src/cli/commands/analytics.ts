import type { Command } from "commander";
import chalk from "chalk";
import { readMessages } from "../../lib/messages.js";
import { listSessions } from "../../lib/sessions.js";
import { getDb, getDbPath, closeDb } from "../../lib/db.js";
import { resolveIdentity } from "../../lib/identity.js";
import { heartbeat, listAgents } from "../../lib/presence.js";
import { addReaction, removeReaction, getReactionSummary } from "../../lib/reactions.js";
import { listHotSessions } from "../../lib/hot.js";
import { getSpaceTopics, getSessionTopics, getTrendingTopics } from "../../lib/topics.js";
import { getConversationSummary } from "../../lib/summary.js";
import { buildGraph, getAgentNetwork, getGraphStats } from "../../lib/graph.js";
import { listSpaceNotificationSubscriptions, readSpaceNotifications } from "../../lib/space-notifications.js";
import { renderContent } from "../../lib/terminal-markdown.js";
import pkg from "../../../package.json";

export function registerAnalyticsCommands(program: Command): void {
  // ---- graph ----
  const graph = program.command("graph").description("Knowledge graph operations");

  graph
    .command("build")
    .description("Build/rebuild knowledge graph from messages, spaces, projects")
    .option("-j, --json", "Output as JSON")
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
    .option("-j, --json", "Output as JSON")
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
    .option("-j, --json", "Output as JSON")
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
    .option("-j, --json", "Output as JSON")
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
    .option("-j, --json", "Output as JSON")
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
    .option("-j, --json", "Output as JSON")
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
    .option("-j, --json", "Output as JSON")
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

      const subscriptions = listSpaceNotificationSubscriptions(agent);
      const spaceNotifications = readSpaceNotifications({
        agent,
        unread_only: true,
        limit: 5,
      });

      // Recent DMs (last 3 messages to me)
      const recentDMs = readMessages({ to: agent, limit: 3 });

      const context = {
        agent,
        online_agents: onlineAgents,
        unread_dms: unreadDMs,
        spaces: mySpaces,
        space_subscriptions: subscriptions,
        space_notifications: spaceNotifications,
        recent_dms: recentDMs,
      };

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

        if (subscriptions.length > 0) {
          console.log(`${chalk.bold("Subscribed spaces:")}`);
          for (const row of subscriptions) {
            console.log(`  ${chalk.magenta("#" + row.space)} ${chalk.dim(`preview ${row.preview_chars} chars`)}`);
          }
        } else {
          console.log(`${chalk.bold("Subscribed spaces:")} ${chalk.dim("none")}`);
        }

        if (spaceNotifications.length > 0) {
          console.log(`${chalk.bold("Space notifications:")}`);
          for (const notification of spaceNotifications) {
            console.log(
              `  ${chalk.dim(notification.created_at.slice(11, 16))} ${chalk.cyan(notification.from_agent)} ${chalk.magenta("#" + notification.space)} ${chalk.dim(`msg #${notification.message_id}`)}`
            );
            console.log(`    ${chalk.dim(notification.preview)}`);
          }
          console.log(chalk.dim("  Inspect with: conversations show <message-id>"));
        } else {
          console.log(`${chalk.bold("Space notifications:")} ${chalk.dim("none")}`);
        }
      }
      closeDb();
    });

  // ---- sessions ----
  program
    .command("sessions")
    .description("List conversation sessions")
    .option("--agent <id>", "Filter sessions involving this agent")
    .option("-j, --json", "Output as JSON")
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

  // ---- status ----
  program
    .command("status")
    .description("Show database stats")
    .option("-j, --json", "Output as JSON")
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
    .option("-j, --json", "Output as JSON")
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
      const { getDataDir } = await import("../../lib/db.js");
      const configPath = process.env.CONVERSATIONS_CONFIG_PATH ?? join(getDataDir(), "config.json");
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

  // ---- react ----
  program
    .command("react")
    .description("Add an emoji reaction to a message")
    .argument("<id>", "Message ID", parseInt)
    .argument("<emoji>", "Emoji to react with")
    .option("--from <agent>", "Agent identity override")
    .option("-j, --json", "Output as JSON")
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
    .option("-j, --json", "Output as JSON")
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
    .option("-j, --json", "Output as JSON")
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
}
