import type { EmailProvider, SendEmailOptions, SendResult } from "../interface.ts";

/** AWS SES adapter — requires @aws-sdk/client-sesv2 */
export class SESEmailProvider implements EmailProvider {
  readonly name = "ses";
  private client: unknown = null;

  private async getClient() {
    if (this.client) return this.client;
    const { SESv2Client } = await import("@aws-sdk/client-sesv2");
    this.client = new SESv2Client({
      region: process.env["AWS_REGION"] ?? "us-east-1",
      credentials: process.env["AWS_ACCESS_KEY_ID"] ? {
        accessKeyId: process.env["AWS_ACCESS_KEY_ID"]!,
        secretAccessKey: process.env["AWS_SECRET_ACCESS_KEY"]!,
      } : undefined,
    });
    return this.client;
  }

  async send(options: SendEmailOptions): Promise<SendResult> {
    const { SESv2Client, SendEmailCommand } = await import("@aws-sdk/client-sesv2");
    const client = (await this.getClient()) as InstanceType<typeof SESv2Client>;

    const cmd = new SendEmailCommand({
      FromEmailAddress: options.from,
      Destination: { ToAddresses: options.to },
      ReplyToAddresses: options.replyTo ? [options.replyTo] : undefined,
      Content: {
        Simple: {
          Subject: { Data: options.subject, Charset: "UTF-8" },
          Body: {
            ...(options.html ? { Html: { Data: options.html, Charset: "UTF-8" } } : {}),
            ...(options.text ? { Text: { Data: options.text, Charset: "UTF-8" } } : {}),
          },
        },
      },
    });

    const result = await client.send(cmd);
    return { messageId: result.MessageId, provider: "ses" };
  }
}
