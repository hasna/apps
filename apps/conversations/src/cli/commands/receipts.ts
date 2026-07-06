import type { Command } from "commander";
import chalk from "chalk";
import { getMessageById, getReadReceipts, getMessageReadStatus } from "../../lib/messages.js";
import { getChannel } from "../../lib/channels.js";
import { closeDb } from "../../lib/db.js";
import { normalizeChannelName } from "../../lib/channel-names.js";

export function registerReceiptCommands(program: Command): void {
  program
    .command("receipts")
    .description("Show per-agent read receipts for a message. With --channel, also lists channel members who have NOT read it.")
    .argument("<message-id>", "Message ID")
    .option("--channel <name>", "Channel name — include members who have not read the message")
    .option("-j, --json", "Output as JSON")
    .action((messageId, opts) => {
      const id = Number(typeof messageId === "string" ? messageId.trim() : messageId);
      if (!Number.isInteger(id) || id <= 0) {
        console.error(chalk.red("Message ID must be a positive integer."));
        process.exit(1);
      }

      const message = getMessageById(id);
      if (!message) {
        console.error(chalk.red(`Message #${id} not found.`));
        process.exit(1);
      }

      const channelArg = typeof opts.channel === "string" ? opts.channel.trim() : "";
      if (opts.channel !== undefined && !channelArg) {
        console.error(chalk.red("Channel name cannot be empty."));
        process.exit(1);
      }

      if (channelArg) {
        if (!getChannel(channelArg)) {
          console.error(chalk.red(`Channel #${channelArg} not found.`));
          process.exit(1);
        }
        const normalizedChannel = normalizeChannelName(channelArg);
        if (message.channel !== normalizedChannel) {
          console.error(chalk.red(`Message #${id} does not belong to channel #${normalizedChannel}.`));
          process.exit(1);
        }
        const status = getMessageReadStatus(id, channelArg);
        if (opts.json) {
          console.log(JSON.stringify({ message_id: id, channel: channelArg, ...status, read_count: status.receipts.length, unread_count: status.unread_by.length }, null, 2));
        } else {
          console.log(chalk.bold(`Message #${id}`) + chalk.dim(` in ${chalk.magenta(`#${channelArg}`)} — read by ${status.receipts.length}, unread by ${status.unread_by.length}`));
          for (const r of status.receipts) {
            console.log(`  ${chalk.green("✓")} ${chalk.cyan(r.agent)} ${chalk.dim(`read ${r.read_at}`)}`);
          }
          for (const agent of status.unread_by) {
            console.log(`  ${chalk.red("✗")} ${chalk.cyan(agent)} ${chalk.dim("unread")}`);
          }
        }
      } else {
        const receipts = getReadReceipts(id);
        if (opts.json) {
          console.log(JSON.stringify({ message_id: id, receipts, count: receipts.length }, null, 2));
        } else if (receipts.length === 0) {
          console.log(chalk.dim(`No read receipts for message #${id}.`));
        } else {
          console.log(chalk.bold(`Message #${id}`) + chalk.dim(` — read by ${receipts.length}`));
          for (const r of receipts) {
            console.log(`  ${chalk.green("✓")} ${chalk.cyan(r.agent)} ${chalk.dim(`read ${r.read_at}`)}`);
          }
        }
      }
      closeDb();
    });
}
