import chalk from "chalk";
import { previewText } from "../lib/compact-output.js";
import { renderContent } from "../lib/terminal-markdown.js";
import type { Message, MessagePreview } from "../types.js";

type PrintableMessage = Message | MessagePreview;

export function printMessageEntry(msg: PrintableMessage, opts: { verbose?: boolean; destination?: string } = {}): void {
  const time = chalk.dim(msg.created_at.slice(11, 19));
  const from = chalk.cyan(msg.from_agent);
  const to = opts.destination
    ? opts.destination
    : msg.channel ? chalk.magenta(`#${msg.channel}`) : chalk.yellow(msg.to_agent);
  const priority = msg.priority !== "normal" ? chalk.red(` [${msg.priority}]`) : "";
  const unreadState = "unread" in msg ? msg.unread : !msg.read_at;
  const unread = unreadState ? chalk.green(" *") : "";
  const blocking = msg.blocking ? chalk.red(" [blocking]") : "";
  const attachmentCount = "attachment_count" in msg ? msg.attachment_count : (msg.attachments?.length ?? 0);
  const attachments = attachmentCount ? chalk.dim(` ${attachmentCount} attachment(s)`) : "";
  console.log(`${time} ${chalk.dim(`[#${msg.id}]`)} ${from} -> ${to}${priority}${blocking}${unread}${attachments}`);
  if ("preview" in msg) {
    console.log(`  ${msg.preview}`);
  } else if (opts.verbose) {
    const rendered = renderContent(msg.content);
    const indented = rendered.split("\n").map((line: string) => "  " + line).join("\n");
    console.log(indented);
  } else {
    console.log(`  ${previewText(msg.content)}`);
  }
}
