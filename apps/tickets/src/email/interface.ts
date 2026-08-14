export interface SendEmailOptions {
  from: string;
  to: string[];
  replyTo?: string;
  subject: string;
  html?: string;
  text?: string;
  headers?: Record<string, string>;
}

export interface SendResult {
  messageId?: string;
  provider: string;
}

export interface EmailProvider {
  readonly name: string;
  send(options: SendEmailOptions): Promise<SendResult>;
}
