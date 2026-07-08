import type { Command } from "commander";
import { getStore } from "../../lib/store/index.js";
import chalk from "chalk";
import { getDb, getDbPath, closeDb } from "../../lib/db.js";
import { resolveIdentity } from "../../lib/identity.js";
import { windowItems } from "../../lib/compact-output.js";
import { cloudStatus } from "../../lib/store/index.js";
import { getCliWindow, printCompactFooter } from "../compact.js";
import pkg from "../../../package.json";

export function registerAnalyticsCommands(program: Command): void {
  // ---- graph ----
  const graph = program.command("graph").description("Knowledge graph operations");

  graph
    .command("build")
    .description("Build/rebuild knowledge graph from messages, channels, projects")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const result = await getStore().buildGraph();
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
    .action(async (opts) => {
      const stats = await getStore().getGraphStats();
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
    .action(async (name, opts) => {
      const network = await getStore().getAgentNetwork(name);
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
        if (network.channels.length > 0) {
          console.log(chalk.bold("  Active channels:"));
          for (const s of network.channels) {
            console.log(`    ${chalk.magenta("#" + s.channel.padEnd(19))} ${chalk.dim(`${s.message_count} msgs`)}`);
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
    .argument("<target>", "Session ID or channel name")
    .option("-j, --json", "Output as JSON")
    .action(async (target, opts) => {
      const summary = await getStore().getConversationSummary(target);
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
    .description("Extract topics from a channel, session, or trending globally")
    .option("--channel <name>", "Topics for a specific channel")
    .option("--session <id>", "Topics for a specific session")
    .option("--hours <n>", "Trending topics in last N hours", parseInt)
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      let topics;
      if (opts.channel) {
        topics = await getStore().getChannelTopics(opts.channel);
      } else if (opts.session) {
        topics = await getStore().getSessionTopics(opts.session);
      } else {
        topics = await getStore().getTrendingTopics({ hours: opts.hours ?? 24 });
      }

      if (opts.json) {
        console.log(JSON.stringify(topics, null, 2));
      } else {
        if (topics.length === 0) {
          console.log(chalk.dim("No topics found."));
        } else {
          const label = opts.channel ? `#${opts.channel}` : opts.session ? opts.session : `last ${opts.hours ?? 24}h`;
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
    .option("--channel <name>", "Filter by channel")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const sessions = await getStore().listHotSessions({
        limit: opts.limit ?? 10,
        min_score: opts.minScore,
        channel: opts.channel,
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
            const where = s.channel ? chalk.magenta(`#${s.channel}`) : chalk.cyan(s.participants.join(", "));
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
    .description("One-shot session boot context for agents: online agents, unread DMs, channels, recent activity")
    .option("--limit <n>", "Max rows per section", parseInt)
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const agent = resolveIdentity();
      const store = getStore();
      await store.heartbeat(agent);
      const window = getCliWindow({ limit: opts.limit });

      // Online agents
      const onlineAgents = await store.listAgents({ online_only: true });

      // Unread DMs
      const unreadDMs = await store.readMessages({ to: agent, unread_only: true, limit: 5 });

      // Channels I'm in (with per-channel unread counts) — routed through the Store
      const myChannels = await store.getMemberChannels(agent);

      const subscriptions = await store.listChannelNotificationSubscriptions(agent);
      const channelNotifications = await store.readChannelNotifications({
        agent,
        unread_only: true,
        limit: 5,
      });

      // Recent DMs (last 3 messages to me)
      const recentDMs = await store.readMessages({ to: agent, limit: 3 });

      const context = {
        agent,
        online_agents: onlineAgents,
        unread_dms: unreadDMs,
        channels: myChannels,
        channel_subscriptions: subscriptions,
        channel_notifications: channelNotifications,
        recent_dms: recentDMs,
      };

      if (opts.json) {
        console.log(JSON.stringify(context, null, 2));
      } else {
        console.log(chalk.bold(`Context for ${chalk.cyan(agent)}\n`));

        // Online agents
        if (onlineAgents.length > 0) {
          const onlinePage = windowItems(onlineAgents, window);
          const names = onlinePage.items.map((a) => chalk.green(a.agent)).join(", ");
          console.log(`${chalk.bold("Online agents:")} ${names}`);
          if (onlinePage.hasMore) console.log(chalk.dim(`  More agents: rerun with --limit ${Math.min(onlineAgents.length, window.limit + 10)}.`));
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

        // Channels
        if (myChannels.length > 0) {
          const channelPage = windowItems(myChannels, window);
          console.log(`${chalk.bold("My channels:")}`);
          for (const sp of channelPage.items) {
            const unread = sp.unread > 0 ? chalk.yellow(` (${sp.unread} unread)`) : "";
            console.log(`  ${chalk.magenta("#" + sp.name)}${unread}`);
          }
          if (channelPage.hasMore) console.log(chalk.dim(`  More channels: rerun with --limit ${Math.min(myChannels.length, window.limit + 10)}.`));
        } else {
          console.log(`${chalk.bold("My channels:")} ${chalk.dim("none")}`);
        }

        if (subscriptions.length > 0) {
          const subscriptionPage = windowItems(subscriptions, window);
          console.log(`${chalk.bold("Subscribed channels:")}`);
          for (const row of subscriptionPage.items) {
            console.log(`  ${chalk.magenta("#" + row.channel)} ${chalk.dim(`preview ${row.preview_chars} chars`)}`);
          }
          if (subscriptionPage.hasMore) console.log(chalk.dim(`  More subscriptions: rerun with --limit ${Math.min(subscriptions.length, window.limit + 10)}.`));
        } else {
          console.log(`${chalk.bold("Subscribed channels:")} ${chalk.dim("none")}`);
        }

        if (channelNotifications.length > 0) {
          console.log(`${chalk.bold("Channel notifications:")}`);
          for (const notification of channelNotifications) {
            console.log(
              `  ${chalk.dim(notification.created_at.slice(11, 16))} ${chalk.cyan(notification.from_agent)} ${chalk.magenta("#" + notification.channel)} ${chalk.dim(`msg #${notification.message_id}`)}`
            );
            console.log(`    ${chalk.dim(notification.preview)}`);
          }
          console.log(chalk.dim("  Inspect with: conversations show <message-id>"));
        } else {
          console.log(`${chalk.bold("Channel notifications:")} ${chalk.dim("none")}`);
        }
      }
      closeDb();
    });

  // ---- sessions ----
  program
    .command("sessions")
    .description("List conversation sessions")
    .option("--agent <id>", "Filter sessions involving this agent")
    .option("--limit <n>", "Max sessions to show", parseInt)
    .option("--cursor <n>", "Skip first N sessions for pagination", parseInt)
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const sessions = await getStore().listSessions(opts.agent);
      const window = getCliWindow({ limit: opts.limit, cursor: opts.cursor });
      const page = windowItems(sessions, window);

      if (opts.json) {
        console.log(JSON.stringify(sessions, null, 2));
      } else {
        if (sessions.length === 0) {
          console.log(chalk.dim("No sessions found."));
        } else {
          for (const s of page.items) {
            const unread = s.unread_count > 0 ? chalk.green(` (${s.unread_count} unread)`) : "";
            const participants = s.participants.join(", ");
            console.log(
              `${chalk.bold(s.session_id)} — ${participants} — ${s.message_count} messages${unread}`
            );
          }
          printCompactFooter({
            shown: page.count,
            total: page.total,
            hasMore: page.hasMore,
            nextCursor: page.nextCursor,
            limitCapped: window.limitCapped,
            detailHint: "Use conversations read --session <id> --verbose for message bodies.",
          });
        }
      }
      closeDb();
    });

  // ---- status ----
  program
    .command("status")
    .description("Show database stats")
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      // Cloud-aware: when self_hosted routing is active, report the cloud store
      // (what agents actually read/write) instead of the stale local db, so
      // operators verifying a flip don't get misled by local counts.
      const cloud = await cloudStatus();
      if (cloud) {
        const stats = {
          mode: "self_hosted",
          api_url: cloud.api_url,
          total_messages: cloud.total_messages,
          unread_messages: cloud.unread_messages,
        };
        if (opts.json) {
          console.log(JSON.stringify(stats, null, 2));
        } else {
          console.log(chalk.bold("Conversations Status"));
          console.log(`  Mode:       self_hosted (cloud API)`);
          console.log(`  API URL:    ${stats.api_url ?? "(set)"}`);
          console.log(`  Messages:   ${stats.total_messages}`);
          console.log(`  Unread:     ${stats.unread_messages}`);
        }
        return;
      }
      const db = getDb();
      const dbPath = getDbPath();
      const totalMessages = (db.prepare("SELECT COUNT(*) as count FROM messages").get() as { count: number }).count;
      const totalSessions = (db.prepare("SELECT COUNT(DISTINCT session_id) as count FROM messages").get() as { count: number }).count;
      const totalUnread = (db.prepare("SELECT COUNT(*) as count FROM messages WHERE read_at IS NULL").get() as { count: number }).count;
      const totalChannels = (db.prepare("SELECT COUNT(*) as count FROM channels").get() as { count: number }).count;
      const totalProjects = (db.prepare("SELECT COUNT(*) as count FROM projects").get() as { count: number }).count;

      const stats = {
        db_path: dbPath,
        total_messages: totalMessages,
        total_sessions: totalSessions,
        total_channels: totalChannels,
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
        console.log(`  Channels:     ${stats.total_channels}`);
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
    .action(async (id, emoji, opts) => {
      const agent = resolveIdentity(opts.from);
      const reaction = await getStore().addReaction(id, agent, emoji);
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
    .action(async (id, emoji, opts) => {
      const agent = resolveIdentity(opts.from);
      const removed = await getStore().removeReaction(id, agent, emoji);
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
    .action(async (id, opts) => {
      const summary = await getStore().getReactionSummary(id);
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
