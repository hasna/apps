import type { Command } from "commander";
import { getStore } from "../../lib/store/index.js";
import chalk from "chalk";
import { getDbPath, closeDb } from "../../lib/db.js";
import { resolveIdentity } from "../../lib/identity.js";
import { windowItems } from "../../lib/compact-output.js";
import { isCloudStore, cloudApiUrl } from "../../lib/store/index.js";
import { checkForUpdate } from "../../lib/version-check.js";
import { getCliWindow, printCompactFooter, printJsonDisclosure, windowJsonList } from "../compact.js";
import { SESSION_LIST_ORDER } from "../../lib/list-order.js";
import { emitCliError } from "../cli-error.js";
import { printErrorLine, printJson, printLine } from "../../lib/stdout.js";

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
        printJson(result);
      } else {
        printLine(chalk.green(`Graph built: ${result.edges_created} created, ${result.edges_updated} updated`));
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
        printJson(stats);
      } else {
        printLine(chalk.bold(`Knowledge Graph: ${stats.total_edges} edges\n`));
        for (const [relation, count] of Object.entries(stats.by_relation)) {
          printLine(`  ${chalk.cyan(relation.padEnd(20))} ${count}`);
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
        printJson(network);
      } else {
        printLine(chalk.bold(`Network for ${chalk.cyan(name)}\n`));
        if (network.communicates_with.length > 0) {
          printLine(chalk.bold("  Communicates with:"));
          for (const c of network.communicates_with) {
            printLine(`    ${chalk.cyan(c.agent.padEnd(20))} ${chalk.dim(`${c.message_count} msgs`)}`);
          }
        }
        if (network.channels.length > 0) {
          printLine(chalk.bold("  Active channels:"));
          for (const s of network.channels) {
            printLine(`    ${chalk.magenta("#" + s.channel.padEnd(19))} ${chalk.dim(`${s.message_count} msgs`)}`);
          }
        }
        if (network.projects.length > 0) {
          printLine(chalk.bold("  Projects:") + " " + network.projects.join(", "));
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
        emitCliError(`No messages found for "${target}"`, opts);
      }

      if (opts.json) {
        printJson(summary);
      } else {
        printLine(chalk.bold(`Summary: ${target}\n`));
        printLine(`  ${chalk.bold("Participants:")} ${summary.participants.join(", ")}`);
        printLine(`  ${chalk.bold("Messages:")} ${summary.message_count}`);
        printLine(`  ${chalk.bold("Date range:")} ${summary.date_range.first.slice(0, 16)} → ${summary.date_range.last.slice(0, 16)}`);
        printLine(`  ${chalk.bold("Replies:")} ${summary.activity.reply_count}  ${chalk.bold("Reactions:")} ${summary.activity.reaction_count}`);

        if (summary.topics.length > 0) {
          printLine(`\n  ${chalk.bold("Topics:")} ${summary.topics.slice(0, 5).map((t) => t.topic).join(", ")}`);
        }

        if (summary.key_messages.length > 0) {
          printLine(`\n  ${chalk.bold("Key messages:")}`);
          for (const k of summary.key_messages.slice(0, 5)) {
            printLine(`    [#${k.id}] ${chalk.cyan(k.from)} (${chalk.yellow(k.reason)}): ${k.content.slice(0, 80)}`);
          }
        }

        if (summary.unresolved_blockers.length > 0) {
          printLine(`\n  ${chalk.red.bold("Unresolved blockers:")}`);
          for (const b of summary.unresolved_blockers) {
            printLine(`    ${chalk.red("[BLOCKER]")} [#${b.id}] ${chalk.cyan(b.from)}: ${b.content.slice(0, 80)}`);
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
        printJson(topics);
      } else {
        if (topics.length === 0) {
          printLine(chalk.dim("No topics found."));
        } else {
          const label = opts.channel ? `#${opts.channel}` : opts.session ? opts.session : `last ${opts.hours ?? 24}h`;
          printLine(chalk.bold(`Topics for ${label}\n`));
          for (const t of topics) {
            const bar = "█".repeat(Math.min(Math.round(t.weight * 50), 30));
            printLine(`  ${chalk.cyan(t.topic.padEnd(20))} ${chalk.dim(`×${t.count}`)}  ${chalk.green(bar)}`);
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

      // `hot` is deliberately NOT given a sort disclosure: its rows are ranked by
      // a composite hotness score, not by a single column, so `sort=<field>` has
      // nothing truthful to say about it. Its `--limit` is applied in the query
      // rather than after it, so the JSON path is already bounded.
      if (opts.json) {
        printJson(sessions);
      } else {
        if (sessions.length === 0) {
          printLine(chalk.dim("No hot conversations."));
        } else {
          printLine(chalk.bold("Hot Conversations\n"));
          for (const s of sessions) {
            const score = s.hotness_score > 20 ? chalk.red(`🔥 ${s.hotness_score}`) : chalk.yellow(`  ${s.hotness_score}`);
            const where = s.channel ? chalk.magenta(`#${s.channel}`) : chalk.cyan(s.participants.join(", "));
            const time = chalk.dim(s.last_message_at.slice(11, 16));
            const msgs = chalk.dim(`${s.message_count} msgs`);
            const agents = chalk.dim(`${s.metrics.unique_agents} agents`);
            printLine(`${score}  ${where}  ${time}  ${msgs}  ${agents}`);
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
        printJson(context);
      } else {
        printLine(chalk.bold(`Context for ${chalk.cyan(agent)}\n`));

        // Online agents
        if (onlineAgents.length > 0) {
          const onlinePage = windowItems(onlineAgents, window);
          const names = onlinePage.items.map((a) => chalk.green(a.agent)).join(", ");
          printLine(`${chalk.bold("Online agents:")} ${names}`);
          if (onlinePage.hasMore) printLine(chalk.dim(`  More agents: rerun with --limit ${Math.min(onlineAgents.length, window.limit + 10)}.`));
        } else {
          printLine(`${chalk.bold("Online agents:")} ${chalk.dim("none")}`);
        }

        // Unread DMs
        if (unreadDMs.length > 0) {
          printLine(`${chalk.bold("Unread DMs:")} ${chalk.yellow(unreadDMs.length + " message(s)")}`);
          for (const msg of unreadDMs.slice(0, 3)) {
            printLine(`  ${chalk.dim(msg.created_at.slice(11, 16))} ${chalk.cyan(msg.from_agent)}: ${msg.content.slice(0, 80)}`);
          }
        } else {
          printLine(`${chalk.bold("Unread DMs:")} ${chalk.dim("none")}`);
        }

        // Channels
        if (myChannels.length > 0) {
          const channelPage = windowItems(myChannels, window);
          printLine(`${chalk.bold("My channels:")}`);
          for (const sp of channelPage.items) {
            const unread = sp.unread > 0 ? chalk.yellow(` (${sp.unread} unread)`) : "";
            printLine(`  ${chalk.magenta("#" + sp.name)}${unread}`);
          }
          if (channelPage.hasMore) printLine(chalk.dim(`  More channels: rerun with --limit ${Math.min(myChannels.length, window.limit + 10)}.`));
        } else {
          printLine(`${chalk.bold("My channels:")} ${chalk.dim("none")}`);
        }

        if (subscriptions.length > 0) {
          const subscriptionPage = windowItems(subscriptions, window);
          printLine(`${chalk.bold("Subscribed channels:")}`);
          for (const row of subscriptionPage.items) {
            printLine(`  ${chalk.magenta("#" + row.channel)} ${chalk.dim(`preview ${row.preview_chars} chars`)}`);
          }
          if (subscriptionPage.hasMore) printLine(chalk.dim(`  More subscriptions: rerun with --limit ${Math.min(subscriptions.length, window.limit + 10)}.`));
        } else {
          printLine(`${chalk.bold("Subscribed channels:")} ${chalk.dim("none")}`);
        }

        if (channelNotifications.length > 0) {
          printLine(`${chalk.bold("Channel notifications:")}`);
          for (const notification of channelNotifications) {
            printLine(
              `  ${chalk.dim(notification.created_at.slice(11, 16))} ${chalk.cyan(notification.from_agent)} ${chalk.magenta("#" + notification.channel)} ${chalk.dim(`msg #${notification.message_id}`)}`
            );
            printLine(`    ${chalk.dim(notification.preview)}`);
          }
          printLine(chalk.dim("  Inspect with: conversations show <message-id>"));
        } else {
          printLine(`${chalk.bold("Channel notifications:")} ${chalk.dim("none")}`);
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
        const listing = windowJsonList(sessions, opts);
        printJson(listing.rows);
        printJsonDisclosure({
          shown: listing.rows.length,
          total: listing.page.total,
          hasMore: listing.bounded && listing.page.hasMore,
          nextCursor: listing.page.nextCursor,
          sort: SESSION_LIST_ORDER,
        });
      } else {
        if (sessions.length === 0) {
          printLine(chalk.dim("No sessions found."));
        } else {
          for (const s of page.items) {
            const unread = s.unread_count > 0 ? chalk.green(` (${s.unread_count} unread)`) : "";
            const participants = s.participants.join(", ");
            printLine(
              `${chalk.bold(s.session_id)} — ${participants} — ${s.message_count} messages${unread}`
            );
          }
          printCompactFooter({
            shown: page.count,
            total: page.total,
            hasMore: page.hasMore,
            nextCursor: page.nextCursor,
            limitCapped: window.limitCapped,
            sort: SESSION_LIST_ORDER,
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
      // ONE path through the Store: counts come from whichever transport the client
      // is flipped to (LocalStore sqlite or the self_hosted/cloud API), so operators
      // verifying a flip see the store agents actually read/write — never raw sqlite,
      // never the stale local db while cloud is active.
      const store = getStore();
      const cloud = isCloudStore();

      const [totalMessages, sessions, channels, projects, totalUnread] = await Promise.all([
        store.countMessages(),
        store.listSessions(),
        store.listChannels({ include_archived: true }),
        store.listProjects(),
        store.countMessages({ unread_only: true }),
      ]);

      const stats: {
        mode: "self_hosted" | "local";
        api_url?: string | null;
        db_path?: string;
        total_messages: number;
        total_sessions: number;
        total_channels: number;
        total_projects: number;
        unread_messages: number;
      } = {
        mode: cloud ? "self_hosted" : "local",
        ...(cloud ? { api_url: cloudApiUrl() } : { db_path: getDbPath() }),
        total_messages: totalMessages,
        total_sessions: sessions.length,
        total_channels: channels.length,
        total_projects: projects.length,
        unread_messages: totalUnread,
      };

      if (opts.json) {
        printJson(stats);
      } else {
        printLine(chalk.bold("Conversations Status"));
        if (cloud) {
          printLine(`  Mode:       self_hosted (cloud API)`);
          printLine(`  API URL:    ${stats.api_url ?? "(set)"}`);
        } else {
          printLine(`  Mode:       local`);
          printLine(`  DB Path:    ${stats.db_path}`);
        }
        printLine(`  Messages:   ${stats.total_messages}`);
        printLine(`  Sessions:   ${stats.total_sessions}`);
        printLine(`  Channels:   ${stats.total_channels}`);
        printLine(`  Projects:   ${stats.total_projects}`);
        printLine(`  Unread:     ${stats.unread_messages}`);
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

      // 1. Storage health — routed through the Store so this reflects the transport
      //    the client is flipped to (local sqlite opens + WAL, or cloud API reach +
      //    auth). No CLI command touches sqlite directly.
      try {
        checks.push(...(await getStore().health()));
      } catch (e: any) {
        checks.push({ name: "Storage", ok: false, message: `Health check failed: ${e.message}` });
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

      // 4. npm version check (registry probe via shared helper — never a raw fetch here)
      {
        const info = await checkForUpdate();
        if (info.latest === null) {
          checks.push({ name: "npm version", ok: true, message: "Could not check npm registry (offline?)" });
        } else if (info.updateAvailable) {
          checks.push({ name: "npm version", ok: false, message: `Update available: v${info.current} → v${info.latest} — run: bun install -g @hasna/conversations@latest` });
        } else {
          checks.push({ name: "npm version", ok: true, message: `OK — v${info.current} (latest)` });
        }
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
        printJson({ ok: allOk, checks });
      } else {
        printLine(chalk.bold("Conversations Doctor\n"));
        for (const check of checks) {
          const icon = check.ok ? chalk.green("✓") : chalk.red("✗");
          const label = chalk.bold(check.name.padEnd(16));
          printLine(`  ${icon}  ${label}  ${check.message}`);
        }
        printLine();
        if (allOk) {
          printLine(chalk.green("All checks passed."));
        } else {
          const failed = checks.filter((c) => !c.ok).length;
          printLine(chalk.red(`${failed} check(s) failed.`));
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
      if (!Number.isInteger(id) || id <= 0) {
        printErrorLine(chalk.red("Message ID must be a positive integer."));
        process.exit(1);
      }
      if (!(await getStore().getMessageById(id))) {
        printErrorLine(chalk.red(`Message #${id} not found.`));
        process.exit(1);
      }
      const agent = resolveIdentity(opts.from);
      let reaction;
      try {
        reaction = await getStore().addReaction(id, agent, emoji);
      } catch (error) {
        emitCliError(error instanceof Error ? error.message : String(error), opts);
      }
      if (opts.json) {
        printJson(reaction);
      } else {
        printLine(chalk.green(`${emoji} reaction added to message #${id}`));
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
        printJson({ removed });
      } else {
        if (removed) {
          printLine(chalk.green(`${emoji} reaction removed from message #${id}`));
        } else {
          printLine(chalk.dim(`No ${emoji} reaction found on message #${id}`));
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
        printJson(summary);
      } else {
        if (summary.length === 0) {
          printLine(chalk.dim(`No reactions on message #${id}`));
        } else {
          const parts = summary.map((r) => `${r.emoji} ${r.count}`).join("  ");
          printLine(`Message #${id}: ${parts}`);
        }
      }
      closeDb();
    });
}
