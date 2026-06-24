import type { Command } from "commander";
import chalk from "chalk";
import { recordReadReceiptsBatch, sendMessage, readMessages } from "../../lib/messages.js";
import { createChannel, updateChannel, archiveChannel, unarchiveChannel, listChannels, getChannel, joinChannel, leaveChannel, getChannelMembers } from "../../lib/channels.js";
import { listChannelNotificationSubscriptions, markChannelNotificationsRead, subscribeToChannelNotifications, unsubscribeFromChannelNotifications } from "../../lib/channel-notifications.js";
import { closeDb } from "../../lib/db.js";
import { resolveIdentity } from "../../lib/identity.js";
import { renderContent } from "../../lib/terminal-markdown.js";

export function registerChannelCommands(program: Command): void {
  const channel = program
    .command("channel")
    .description("Manage channels");

  channel
    .command("create")
    .description("Create a new channel")
    .argument("<name>", "Channel name")
    .option("--description <text>", "Channel description")
    .option("--topic <text>", "Channel topic")
    .option("--project <id>", "Project ID to associate with")
    .option("--from <agent>", "Creator agent ID")
    .option("-j, --json", "Output as JSON")
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
        const topic = typeof opts.topic === "string" && opts.topic.trim()
          ? opts.topic.trim()
          : undefined;
        const sp = createChannel(channelName, agent, {
          description,
          topic,
          project_id: opts.project,
        });
        if (opts.json) {
          console.log(JSON.stringify(sp, null, 2));
        } else {
          console.log(chalk.green(`Channel #${sp.name} created`) + (sp.description ? chalk.dim(` — ${sp.description}`) : ""));
        }
      } catch (e: any) {
        if (e.message?.includes("UNIQUE constraint")) {
          console.error(chalk.red(`Channel #${channelName} already exists.`));
          process.exit(1);
        }
        console.error(chalk.red(e.message));
        process.exit(1);
      }
      closeDb();
    });

  channel
    .command("list")
    .description("List all channels")
    .option("--project <id>", "Filter by project ID")
    .option("--archived", "Include archived channels")
    .option("-j, --json", "Output as JSON")
    .action((opts) => {
      const listOpts: { project_id?: string; include_archived?: boolean } = {};
      if (opts.project) listOpts.project_id = opts.project;
      if (opts.archived) listOpts.include_archived = true;

      const channels = listChannels(listOpts);

      if (opts.json) {
        console.log(JSON.stringify(channels, null, 2));
      } else {
        if (channels.length === 0) {
          console.log(chalk.dim("No channels found."));
        } else {
          for (const sp of channels) {
            const desc = sp.description ? chalk.dim(` — ${sp.description}`) : "";
            const archived = sp.archived_at ? chalk.yellow(" [archived]") : "";
            console.log(`${chalk.magenta(`#${sp.name}`)}${desc}${archived}  ${sp.member_count} members, ${sp.message_count} messages`);
          }
        }
      }
      closeDb();
    });

  channel
    .command("update")
    .description("Update a channel")
    .argument("<name>", "Channel name")
    .option("--description <text>", "New description")
    .option("--topic <text>", "New topic")
    .option("--project <id>", "New project ID")
    .option("-j, --json", "Output as JSON")
    .action((name, opts) => {
      const channelName = typeof name === "string" ? name.trim() : "";
      if (!channelName) {
        console.error(chalk.red("Channel name cannot be empty."));
        process.exit(1);
      }

      const updates: { description?: string; topic?: string | null; project_id?: string | null } = {};
      if (opts.description !== undefined) updates.description = opts.description;
      if (opts.topic !== undefined) updates.topic = opts.topic || null;
      if (opts.project !== undefined) updates.project_id = opts.project || null;

      try {
        const sp = updateChannel(channelName, updates);
        if (opts.json) {
          console.log(JSON.stringify(sp, null, 2));
        } else {
          console.log(chalk.green(`Channel #${sp.name} updated.`));
        }
      } catch (e: any) {
        console.error(chalk.red(e.message));
        process.exit(1);
      }
      closeDb();
    });

  channel
    .command("archive")
    .description("Archive a channel")
    .argument("<name>", "Channel name")
    .option("-j, --json", "Output as JSON")
    .action((name, opts) => {
      const channelName = typeof name === "string" ? name.trim() : "";
      if (!channelName) {
        console.error(chalk.red("Channel name cannot be empty."));
        process.exit(1);
      }

      try {
        const sp = archiveChannel(channelName);
        if (opts.json) {
          console.log(JSON.stringify(sp, null, 2));
        } else {
          console.log(chalk.green(`Channel #${sp.name} archived.`));
        }
      } catch (e: any) {
        console.error(chalk.red(e.message));
        process.exit(1);
      }
      closeDb();
    });

  channel
    .command("unarchive")
    .description("Unarchive a channel")
    .argument("<name>", "Channel name")
    .option("-j, --json", "Output as JSON")
    .action((name, opts) => {
      const channelName = typeof name === "string" ? name.trim() : "";
      if (!channelName) {
        console.error(chalk.red("Channel name cannot be empty."));
        process.exit(1);
      }

      try {
        const sp = unarchiveChannel(channelName);
        if (opts.json) {
          console.log(JSON.stringify(sp, null, 2));
        } else {
          console.log(chalk.green(`Channel #${sp.name} unarchived.`));
        }
      } catch (e: any) {
        console.error(chalk.red(e.message));
        process.exit(1);
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
    .option("-j, --json", "Output as JSON")
    .action((channelName, message, opts) => {
      const from = resolveIdentity(opts.from).trim();
      const channelArg = typeof channelName === "string" ? channelName.trim() : "";
      const content = typeof message === "string" ? message : "";

      if (!from) {
        console.error(chalk.red("Sender identity is required."));
        process.exit(1);
      }
      if (!channelArg) {
        console.error(chalk.red("Channel name cannot be empty."));
        process.exit(1);
      }
      if (!content.trim()) {
        console.error(chalk.red("Message content cannot be empty."));
        process.exit(1);
      }

      const sp = getChannel(channelArg);
      if (!sp) {
        console.error(chalk.red(`Channel #${channelArg} not found.`));
        process.exit(1);
      }

      const msg = sendMessage({
        from,
        to: channelArg,
        content,
        channel: channelArg,
        session_id: `channel:${channelArg}`,
        priority: opts.priority,
      });

      if (opts.json) {
        console.log(JSON.stringify(msg, null, 2));
      } else {
        console.log(chalk.green(`Message sent to #${channelArg}`) + chalk.dim(` (id: ${msg.id})`));
      }
      closeDb();
    });

  channel
    .command("read")
    .description("Read messages from a channel")
    .argument("<channel>", "Channel name")
    .option("--from <agent>", "Agent reading the channel")
    .option("--since <timestamp>", "Messages after this ISO timestamp")
    .option("--limit <n>", "Max messages to return", parseInt)
    .option("-j, --json", "Output as JSON")
    .action((channelName, opts) => {
      const channelArg = typeof channelName === "string" ? channelName.trim() : "";
      if (!channelArg) {
        console.error(chalk.red("Channel name cannot be empty."));
        process.exit(1);
      }
      const messages = readMessages({
        channel: channelArg,
        since: opts.since,
        limit: opts.limit,
      });

      if (opts.from && messages.length > 0) {
        const agent = resolveIdentity(opts.from).trim();
        if (!agent) {
          console.error(chalk.red("Agent identity is required."));
          process.exit(1);
        }
        recordReadReceiptsBatch(messages.map((m) => m.id), agent);
        markChannelNotificationsRead(agent, messages.map((m) => m.id));
      }

      if (opts.json) {
        console.log(JSON.stringify(messages, null, 2));
      } else {
        if (messages.length === 0) {
          console.log(chalk.dim(`No messages in #${channelArg}.`));
        } else {
          for (const msg of messages) {
            const time = chalk.dim(msg.created_at.slice(11, 19));
            const from = chalk.cyan(msg.from_agent);
            const priority = msg.priority !== "normal" ? chalk.red(` [${msg.priority}]`) : "";
            console.log(`${time} ${from} → ${chalk.magenta(`#${channelArg}`)}${priority}`);
            const rendered = renderContent(msg.content);
            const indented = rendered.split("\n").map((l: string) => "  " + l).join("\n");
            console.log(indented);
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
    .option("-j, --json", "Output as JSON")
    .action((channelName, opts) => {
      const agent = resolveIdentity(opts.from).trim();
      const channelArg = typeof channelName === "string" ? channelName.trim() : "";

      if (!agent) {
        console.error(chalk.red("Agent identity is required."));
        process.exit(1);
      }
      if (!channelArg) {
        console.error(chalk.red("Channel name cannot be empty."));
        process.exit(1);
      }

      const ok = joinChannel(channelArg, agent);

      if (!ok) {
        console.error(chalk.red(`Channel #${channelArg} not found.`));
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify({ channel: channelArg, agent, joined: true }));
      } else {
        console.log(chalk.green(`${agent} joined #${channelArg}`));
      }
      closeDb();
    });

  channel
    .command("leave")
    .description("Leave a channel")
    .argument("<channel>", "Channel name")
    .option("--from <agent>", "Agent ID")
    .option("-j, --json", "Output as JSON")
    .action((channelName, opts) => {
      const agent = resolveIdentity(opts.from).trim();
      const channelArg = typeof channelName === "string" ? channelName.trim() : "";

      if (!agent) {
        console.error(chalk.red("Agent identity is required."));
        process.exit(1);
      }
      if (!channelArg) {
        console.error(chalk.red("Channel name cannot be empty."));
        process.exit(1);
      }

      const ok = leaveChannel(channelArg, agent);

      if (opts.json) {
        console.log(JSON.stringify({ channel: channelArg, agent, left: ok }));
      } else {
        if (ok) {
          console.log(chalk.green(`${agent} left #${channelArg}`));
        } else {
          console.log(chalk.dim(`${agent} was not a member of #${channelArg}`));
        }
      }
      closeDb();
    });

  channel
    .command("subscribe")
    .description("Subscribe to preview-only notifications for a channel")
    .argument("<channel>", "Channel name")
    .option("--from <agent>", "Agent ID")
    .option("--preview-chars <n>", "Preview length", parseInt)
    .option("-j, --json", "Output as JSON")
    .action((channelName, opts) => {
      const agent = resolveIdentity(opts.from).trim();
      const channelArg = typeof channelName === "string" ? channelName.trim() : "";

      if (!agent) {
        console.error(chalk.red("Agent identity is required."));
        process.exit(1);
      }
      if (!channelArg) {
        console.error(chalk.red("Channel name cannot be empty."));
        process.exit(1);
      }

      try {
        const subscription = subscribeToChannelNotifications(channelArg, agent, { preview_chars: opts.previewChars });
        if (opts.json) {
          console.log(JSON.stringify(subscription, null, 2));
        } else {
          console.log(chalk.green(`${agent} subscribed to #${channelArg} notifications`) + chalk.dim(` (${subscription.preview_chars} chars)`));
        }
      } catch (e: any) {
        console.error(chalk.red(e.message));
        process.exit(1);
      }
      closeDb();
    });

  channel
    .command("unsubscribe")
    .description("Stop preview-only notifications for a channel")
    .argument("<channel>", "Channel name")
    .option("--from <agent>", "Agent ID")
    .option("-j, --json", "Output as JSON")
    .action((channelName, opts) => {
      const agent = resolveIdentity(opts.from).trim();
      const channelArg = typeof channelName === "string" ? channelName.trim() : "";

      if (!agent) {
        console.error(chalk.red("Agent identity is required."));
        process.exit(1);
      }
      if (!channelArg) {
        console.error(chalk.red("Channel name cannot be empty."));
        process.exit(1);
      }

      const unsubscribed = unsubscribeFromChannelNotifications(channelArg, agent);
      if (opts.json) {
        console.log(JSON.stringify({ channel: channelArg, agent, unsubscribed }));
      } else if (unsubscribed) {
        console.log(chalk.green(`${agent} unsubscribed from #${channelArg} notifications`));
      } else {
        console.log(chalk.dim(`${agent} had no notification subscription for #${channelArg}`));
      }
      closeDb();
    });

  channel
    .command("subscriptions")
    .description("List preview-only channel notification subscriptions")
    .option("--from <agent>", "Agent ID")
    .option("--channel <name>", "Filter by channel")
    .option("-j, --json", "Output as JSON")
    .action((opts) => {
      const agent = resolveIdentity(opts.from).trim();
      if (!agent) {
        console.error(chalk.red("Agent identity is required."));
        process.exit(1);
      }

      let subscriptions = listChannelNotificationSubscriptions(agent);
      if (opts.channel) {
        subscriptions = subscriptions.filter((row) => row.channel === opts.channel);
      }

      if (opts.json) {
        console.log(JSON.stringify(subscriptions, null, 2));
      } else if (subscriptions.length === 0) {
        console.log(chalk.dim(`No notification subscriptions for ${agent}.`));
      } else {
        console.log(chalk.bold(`${agent} notification subscriptions:`));
        for (const row of subscriptions) {
          console.log(`  ${chalk.magenta(`#${row.channel}`)} ${chalk.dim(`preview ${row.preview_chars} chars`)}`);
        }
      }
      closeDb();
    });

  channel
    .command("members")
    .description("List channel members")
    .argument("<channel>", "Channel name")
    .option("-j, --json", "Output as JSON")
    .action((channelName, opts) => {
      const channelArg = typeof channelName === "string" ? channelName.trim() : "";
      if (!channelArg) {
        console.error(chalk.red("Channel name cannot be empty."));
        process.exit(1);
      }
      const members = getChannelMembers(channelArg);

      if (opts.json) {
        console.log(JSON.stringify(members, null, 2));
      } else {
        if (members.length === 0) {
          console.log(chalk.dim(`No members in #${channelArg}.`));
        } else {
          console.log(chalk.magenta(`#${channelArg}`) + chalk.dim(` — ${members.length} member(s)`));
          for (const m of members) {
            console.log(`  ${chalk.cyan(m.agent)} ${chalk.dim(`joined ${m.joined_at.slice(0, 10)}`)}`);
          }
        }
      }
      closeDb();
    });
}
