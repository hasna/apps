import type { Command } from "commander";
import { getStore } from "../../lib/store/index.js";
import chalk from "chalk";
import { closeDb } from "../../lib/db.js";
import { normalizeChannelName } from "../../lib/channel-names.js";
import { emitCliError } from "../cli-error.js";
import { printJson } from "../stdout.js";

export function registerReceiptCommands(program: Command): void {
  program
    .command("receipts")
    .description("Show per-agent read receipts for a message. With --channel, also lists channel members who have NOT read it.")
    .argument("<message-id>", "Message ID")
    .option("--channel <name>", "Channel name — include members who have not read the message")
    .option("-j, --json", "Output as JSON")
    .action(async (messageId, opts) => {
      const id = Number(typeof messageId === "string" ? messageId.trim() : messageId);
      if (!Number.isInteger(id) || id <= 0) {
        emitCliError("Message ID must be a positive integer.", opts);
      }

      const message = await getStore().getMessageById(id);
      if (!message) {
        emitCliError(`Message #${id} not found.`, opts);
      }

      const channelArg = typeof opts.channel === "string" ? opts.channel.trim() : "";
      if (opts.channel !== undefined && !channelArg) {
        emitCliError("Channel name cannot be empty.", opts);
      }

      if (channelArg) {
        if (!await getStore().getChannel(channelArg)) {
          emitCliError(`Channel #${channelArg} not found.`, opts);
        }
        const normalizedChannel = normalizeChannelName(channelArg);
        if (message.channel !== normalizedChannel) {
          emitCliError(`Message #${id} does not belong to channel #${normalizedChannel}.`, opts);
        }
        const status = await getStore().getMessageReadStatus(id, channelArg);
        if (opts.json) {
          printJson({ message_id: id, channel: channelArg, ...status, read_count: status.receipts.length, unread_count: status.unread_by.length });
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
        const receipts = await getStore().getReadReceipts(id);
        if (opts.json) {
          printJson({ message_id: id, receipts, count: receipts.length });
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
