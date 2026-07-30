import chalk from "chalk";
import { previewText } from "../lib/compact-output.js";
import { renderContent } from "../lib/terminal-markdown.js";
import type { Message } from "../types.js";
import { printLine } from "../lib/stdout.js";

export function printMessageEntry(msg: Message, opts: { verbose?: boolean; destination?: string } = {}): void {
  const time = chalk.dim(msg.created_at.slice(11, 19));
  const from = chalk.cyan(msg.from_agent);
  const to = opts.destination
    ? opts.destination
    : msg.channel ? chalk.magenta(`#${msg.channel}`) : chalk.yellow(msg.to_agent);
  const priority = msg.priority !== "normal" ? chalk.red(` [${msg.priority}]`) : "";
  const unread = !msg.read_at ? chalk.green(" *") : "";
  const blocking = msg.blocking ? chalk.red(" [blocking]") : "";
  const attachments = msg.attachments?.length ? chalk.dim(` ${msg.attachments.length} attachment(s)`) : "";
  printLine(`${time} ${chalk.dim(`[#${msg.id}]`)} ${from} -> ${to}${priority}${blocking}${unread}${attachments}`);
  if (opts.verbose) {
    const rendered = renderContent(msg.content);
    const indented = rendered.split("\n").map((line: string) => "  " + line).join("\n");
    printLine(indented);
  } else {
    printLine(`  ${previewText(msg.content)}`);
  }
}
