import type { EmailProvider, SendEmailOptions, SendResult } from "../interface.ts";

/** Resend adapter — requires resend npm package */
export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";
  private client: unknown = null;

  private async getClient() {
    if (this.client) return this.client;
    const { Resend } = await import("resend");
    this.client = new Resend(process.env["RESEND_API_KEY"]);
    return this.client;
  }

  async send(options: SendEmailOptions): Promise<SendResult> {
    const { Resend } = await import("resend");
    const client = (await this.getClient()) as InstanceType<typeof Resend>;

    const result = await client.emails.send({
      from: options.from,
      to: options.to,
      reply_to: options.replyTo,
      subject: options.subject,
      html: options.html,
      text: options.text,
      headers: options.headers,
    });

    if (result.error) throw new Error(`Resend error: ${result.error.message}`);
    return { messageId: result.data?.id, provider: "resend" };
  }
}
