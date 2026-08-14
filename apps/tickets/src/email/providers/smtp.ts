import type { EmailProvider, SendEmailOptions, SendResult } from "../interface.ts";

/** SMTP adapter via nodemailer — outbound only */
export class SMTPEmailProvider implements EmailProvider {
  readonly name = "smtp";
  private transporter: unknown = null;

  private async getTransporter() {
    if (this.transporter) return this.transporter;
    const nodemailer = await import("nodemailer");
    this.transporter = nodemailer.createTransport({
      host: process.env["SMTP_HOST"] ?? "localhost",
      port: parseInt(process.env["SMTP_PORT"] ?? "587", 10),
      secure: process.env["SMTP_SECURE"] === "true",
      auth: process.env["SMTP_USER"] ? {
        user: process.env["SMTP_USER"],
        pass: process.env["SMTP_PASS"],
      } : undefined,
    });
    return this.transporter;
  }

  async send(options: SendEmailOptions): Promise<SendResult> {
    const nodemailer = await import("nodemailer");
    type Transporter = ReturnType<typeof nodemailer.createTransport>;
    const transport = (await this.getTransporter()) as Transporter;

    const info = await transport.sendMail({
      from: options.from,
      to: options.to.join(", "),
      replyTo: options.replyTo,
      subject: options.subject,
      html: options.html,
      text: options.text,
      headers: options.headers,
    });

    return { messageId: info.messageId as string, provider: "smtp" };
  }
}
