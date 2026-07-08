import type { Command } from "commander";
import { getStore } from "../../lib/store/index.js";
import chalk from "chalk";
// Reads/writes route through getStore(): ApiStore (self_hosted/cloud) or LocalStore.
import { closeDb } from "../../lib/db.js";
import { resolveIdentity } from "../../lib/identity.js";
import { previewText, windowItems } from "../../lib/compact-output.js";
import { getCliWindow, pageFromQuery, printCompactFooter, queryLimitFor } from "../compact.js";
import { printMessageEntry } from "../message-output.js";

/**
 * Merge a channel class into existing channel metadata at `metadata.channel_schema.class`,
 * preserving unrelated metadata keys. An empty class clears the field; returns null when
 * the merge leaves no metadata at all.
 */
export function mergeChannelClassMetadata(
  existing: Record<string, unknown> | null | undefined,
  channelClass: string,
): Record<string, unknown> | null {
  const meta: Record<string, unknown> = { ...(existing ?? {}) };
  const rawSchema = meta.channel_schema;
  const schema: Record<string, unknown> =
    rawSchema && typeof rawSchema === "object" && !Array.isArray(rawSchema)
      ? { ...(rawSchema as Record<string, unknown>) }
      : {};
  const trimmed = channelClass.trim();
  if (trimmed) {
    schema.class = trimmed;
  } else {
    delete schema.class;
  }
  if (Object.keys(schema).length > 0) {
    meta.channel_schema = schema;
  } else {
    delete meta.channel_schema;
  }
  return Object.keys(meta).length > 0 ? meta : null;
}

/** Read the channel class from channel metadata (`metadata.channel_schema.class`), if set. */
export function channelClassOf(metadata: Record<string, unknown> | null | undefined): string | null {
  const schema = metadata?.channel_schema;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return null;
  const channelClass = (schema as Record<string, unknown>).class;
  return typeof channelClass === "string" && channelClass.trim() ? channelClass : null;
}

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
    .option("--class <class>", "Channel class stored at metadata.channel_schema.class (e.g. fleet, package, product, loop-lane, initiative, personal)")
    .option("--from <agent>", "Creator agent ID")
    .option("-j, --json", "Output as JSON")
    .action(async (name, opts) => {
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
        const channelClass = typeof opts.class === "string" && opts.class.trim()
          ? opts.class.trim()
          : undefined;
        const sp = await getStore().createChannel(channelName, agent, {
          description,
          topic,
          project_id: opts.project,
          metadata: channelClass ? mergeChannelClassMetadata(null, channelClass) ?? undefined : undefined,
        });
        if (opts.json) {
          console.log(JSON.stringify(sp, null, 2));
        } else {
          const clsLabel = channelClassOf(sp.metadata);
          console.log(chalk.green(`Channel #${sp.name} created`) + (clsLabel ? chalk.cyan(` [${clsLabel}]`) : "") + (sp.description ? chalk.dim(` — ${sp.description}`) : ""));
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
    .option("--limit <n>", "Max channels to show", parseInt)
    .option("--cursor <n>", "Skip first N channels for pagination", parseInt)
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const listOpts: { project_id?: string; include_archived?: boolean } = {};
      if (opts.project) listOpts.project_id = opts.project;
      if (opts.archived) listOpts.include_archived = true;

      const channels = await getStore().listChannels(listOpts);
      const window = getCliWindow({ limit: opts.limit, cursor: opts.cursor });
      const page = windowItems(channels, window);

      if (opts.json) {
        console.log(JSON.stringify(channels, null, 2));
      } else {
        if (channels.length === 0) {
          console.log(chalk.dim("No channels found."));
        } else {
          for (const sp of page.items) {
            const desc = sp.description ? chalk.dim(` - ${previewText(sp.description, 90)}`) : "";
            const topic = sp.topic ? chalk.dim(` topic: ${previewText(sp.topic, 70)}`) : "";
            const archived = sp.archived_at ? chalk.yellow(" [archived]") : "";
            const clsLabel = channelClassOf(sp.metadata);
            const cls = clsLabel ? chalk.cyan(` [${clsLabel}]`) : "";
            console.log(`${chalk.magenta(`#${sp.name}`)}${cls}${desc}${archived}  ${sp.member_count} members, ${sp.message_count} messages${topic}`);
          }
          printCompactFooter({
            shown: page.count,
            total: page.total,
            hasMore: page.hasMore,
            nextCursor: page.nextCursor,
            limitCapped: window.limitCapped,
            detailHint: "Use conversations channel read <name> --verbose for message bodies.",
          });
        }
      }
      closeDb();
    });

  channel
    .command("update")
    .description("Update a channel")
    .argument("<name>", "Channel name")
    .option("--name <new-name>", "Rename the channel to this name")
    .option("--description <text>", "New description")
    .option("--topic <text>", "New topic")
    .option("--project <id>", "New project ID")
    .option("--class <class>", "Set channel class at metadata.channel_schema.class (empty value clears it); other metadata keys are preserved")
    .option("-j, --json", "Output as JSON")
    .action(async (name, opts) => {
      const channelName = typeof name === "string" ? name.trim() : "";
      if (!channelName) {
        console.error(chalk.red("Channel name cannot be empty."));
        process.exit(1);
      }

      const updates: { name?: string; description?: string; topic?: string | null; project_id?: string | null; metadata?: Record<string, unknown> | null } = {};
      if (opts.name !== undefined) {
        const newName = typeof opts.name === "string" ? opts.name.trim() : "";
        if (!newName) {
          console.error(chalk.red("New channel name cannot be empty."));
          process.exit(1);
        }
        updates.name = newName;
      }
      if (opts.description !== undefined) updates.description = opts.description;
      if (opts.topic !== undefined) updates.topic = opts.topic || null;
      if (opts.project !== undefined) updates.project_id = opts.project || null;
      if (opts.class !== undefined) {
        const existing = await getStore().getChannel(channelName);
        if (!existing) {
          console.error(chalk.red(`Channel not found: ${channelName}`));
          process.exit(1);
        }
        updates.metadata = mergeChannelClassMetadata(existing.metadata, String(opts.class));
      }

      try {
        const sp = await getStore().updateChannel(channelName, updates);
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
    .command("rename")
    .description("Rename a channel, preserving its messages, members, and history")
    .argument("<name>", "Current channel name")
    .argument("<new-name>", "New channel name")
    .option("-j, --json", "Output as JSON")
    .action(async (name, newName, opts) => {
      const channelName = typeof name === "string" ? name.trim() : "";
      const target = typeof newName === "string" ? newName.trim() : "";
      if (!channelName) {
        console.error(chalk.red("Channel name cannot be empty."));
        process.exit(1);
      }
      if (!target) {
        console.error(chalk.red("New channel name cannot be empty."));
        process.exit(1);
      }

      try {
        const sp = await getStore().renameChannel(channelName, target);
        if (opts.json) {
          console.log(JSON.stringify(sp, null, 2));
        } else {
          console.log(chalk.green(`Channel renamed to #${sp.name}.`));
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
    .action(async (name, opts) => {
      const channelName = typeof name === "string" ? name.trim() : "";
      if (!channelName) {
        console.error(chalk.red("Channel name cannot be empty."));
        process.exit(1);
      }

      try {
        const sp = await getStore().archiveChannel(channelName);
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
    .action(async (name, opts) => {
      const channelName = typeof name === "string" ? name.trim() : "";
      if (!channelName) {
        console.error(chalk.red("Channel name cannot be empty."));
        process.exit(1);
      }

      try {
        const sp = await getStore().unarchiveChannel(channelName);
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
    .action(async (channelName, message, opts) => {
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

      const sp = await getStore().getChannel(channelArg);
      if (!sp) {
        console.error(chalk.red(`Channel #${channelArg} not found.`));
        process.exit(1);
      }

      const msg = await await getStore().sendMessage({
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
    .option("--cursor <n>", "Skip first N messages for pagination", parseInt)
    .option("--verbose", "Show full message bodies")
    .option("-j, --json", "Output as JSON")
    .action(async (channelName, opts) => {
      const channelArg = typeof channelName === "string" ? channelName.trim() : "";
      if (!channelArg) {
        console.error(chalk.red("Channel name cannot be empty."));
        process.exit(1);
      }
      const window = getCliWindow({ limit: opts.limit, cursor: opts.cursor });
      const messages = await await getStore().readMessages({
        channel: channelArg,
        since: opts.since,
        limit: opts.json ? opts.limit : queryLimitFor(window),
        offset: opts.json ? opts.cursor : window.offset,
      });
      const page = opts.json
        ? { items: messages, count: messages.length, hasMore: false, nextCursor: null }
        : pageFromQuery(messages, window);

      if (opts.from && page.items.length > 0) {
        const agent = resolveIdentity(opts.from).trim();
        if (!agent) {
          console.error(chalk.red("Agent identity is required."));
          process.exit(1);
        }
        await await getStore().recordReadReceiptsBatch(page.items.map((m) => m.id), agent);
        await getStore().markChannelNotificationsRead(agent, page.items.map((m) => m.id));
      }

      if (opts.json) {
        console.log(JSON.stringify(messages, null, 2));
      } else {
        if (messages.length === 0) {
          console.log(chalk.dim(`No messages in #${channelArg}.`));
        } else {
          for (const msg of page.items) printMessageEntry(msg, { verbose: opts.verbose, destination: chalk.magenta(`#${channelArg}`) });
          printCompactFooter({
            shown: page.count,
            hasMore: page.hasMore,
            nextCursor: page.nextCursor,
            limitCapped: window.limitCapped,
            detailHint: opts.verbose ? "Use conversations show <id> for one message." : "Use --verbose for full bodies or conversations show <id> for one message.",
          });
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
    .action(async (channelName, opts) => {
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

      const ok = await getStore().joinChannel(channelArg, agent);

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
    .action(async (channelName, opts) => {
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

      const ok = await getStore().leaveChannel(channelArg, agent);

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
    .action(async (channelName, opts) => {
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
        const subscription = await getStore().subscribeToChannelNotifications(channelArg, agent, { preview_chars: opts.previewChars });
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
    .action(async (channelName, opts) => {
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

      const unsubscribed = await getStore().unsubscribeFromChannelNotifications(channelArg, agent);
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
    .option("--limit <n>", "Max subscriptions to show", parseInt)
    .option("--cursor <n>", "Skip first N subscriptions for pagination", parseInt)
    .option("-j, --json", "Output as JSON")
    .action(async (opts) => {
      const agent = resolveIdentity(opts.from).trim();
      if (!agent) {
        console.error(chalk.red("Agent identity is required."));
        process.exit(1);
      }

      let subscriptions = await getStore().listChannelNotificationSubscriptions(agent);
      if (opts.channel) {
        subscriptions = subscriptions.filter((row) => row.channel === opts.channel);
      }
      const window = getCliWindow({ limit: opts.limit, cursor: opts.cursor });
      const page = windowItems(subscriptions, window);

      if (opts.json) {
        console.log(JSON.stringify(subscriptions, null, 2));
      } else if (subscriptions.length === 0) {
        console.log(chalk.dim(`No notification subscriptions for ${agent}.`));
      } else {
        console.log(chalk.bold(`${agent} notification subscriptions:`));
        for (const row of page.items) {
          console.log(`  ${chalk.magenta(`#${row.channel}`)} ${chalk.dim(`preview ${row.preview_chars} chars`)}`);
        }
        printCompactFooter({
          shown: page.count,
          total: page.total,
          hasMore: page.hasMore,
          nextCursor: page.nextCursor,
          limitCapped: window.limitCapped,
        });
      }
      closeDb();
    });

  channel
    .command("members")
    .description("List channel members")
    .argument("<channel>", "Channel name")
    .option("--limit <n>", "Max members to show", parseInt)
    .option("--cursor <n>", "Skip first N members for pagination", parseInt)
    .option("-j, --json", "Output as JSON")
    .action(async (channelName, opts) => {
      const channelArg = typeof channelName === "string" ? channelName.trim() : "";
      if (!channelArg) {
        console.error(chalk.red("Channel name cannot be empty."));
        process.exit(1);
      }
      const members = await getStore().getChannelMembers(channelArg);
      const window = getCliWindow({ limit: opts.limit, cursor: opts.cursor });
      const page = windowItems(members, window);

      if (opts.json) {
        console.log(JSON.stringify(members, null, 2));
      } else {
        if (members.length === 0) {
          console.log(chalk.dim(`No members in #${channelArg}.`));
        } else {
          console.log(chalk.magenta(`#${channelArg}`) + chalk.dim(` — ${members.length} member(s)`));
          for (const m of page.items) {
            console.log(`  ${chalk.cyan(m.agent)} ${chalk.dim(`joined ${m.joined_at.slice(0, 10)}`)}`);
          }
          printCompactFooter({
            shown: page.count,
            total: page.total,
            hasMore: page.hasMore,
            nextCursor: page.nextCursor,
            limitCapped: window.limitCapped,
          });
        }
      }
      closeDb();
    });
}
