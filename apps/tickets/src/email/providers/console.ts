import type { EmailProvider, SendEmailOptions, SendResult } from "../interface.ts";

/** Dev default — logs email to stdout, never sends real email. */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console";

  async send(options: SendEmailOptions): Promise<SendResult> {
    console.log("\n[email:console] ─────────────────────────────");
    console.log(`  From:    ${options.from}`);
    console.log(`  To:      ${options.to.join(", ")}`);
    if (options.replyTo) console.log(`  ReplyTo: ${options.replyTo}`);
    console.log(`  Subject: ${options.subject}`);
    if (options.text) console.log(`  Body:\n${options.text.slice(0, 300)}`);
    console.log("─────────────────────────────────────────────\n");
    return { messageId: `console-${Date.now()}`, provider: "console" };
  }
}
