import type {
  TransactionalEmailParams,
  TransactionalEmailResponse,
} from '../types';

// JetSend API for transactional emails
const JETSEND_BASE_URL = 'https://app.jetsend.com/api/v1';

/**
 * Transactional Email API module for Maropost
 * Uses JetSend API for sending transactional emails
 */
export class TransactionalApi {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl || JETSEND_BASE_URL;
  }

  /**
   * Send a transactional email
   */
  async send(params: TransactionalEmailParams): Promise<TransactionalEmailResponse> {
    const response = await fetch(`${this.baseUrl}/transmission/email`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Transactional email failed: ${error}`);
    }

    return response.json();
  }

  /**
   * Send a simple transactional email
   */
  async sendSimple(options: {
    to: string;
    toName?: string;
    subject: string;
    html?: string;
    text?: string;
    from?: { email: string; name?: string };
    replyTo?: string;
    substitutions?: Record<string, string>;
  }): Promise<TransactionalEmailResponse> {
    return this.send({
      recipients: [
        {
          address: {
            email: options.to,
            name: options.toName,
          },
          substitution_data: options.substitutions,
        },
      ],
      content: {
        subject: options.subject,
        html: options.html,
        text: options.text,
        from: options.from,
        reply_to: options.replyTo,
      },
    });
  }

  /**
   * Send batch transactional emails
   */
  async sendBatch(
    recipients: Array<{
      email: string;
      name?: string;
      substitutions?: Record<string, string>;
    }>,
    content: {
      subject: string;
      html?: string;
      text?: string;
      from?: { email: string; name?: string };
    }
  ): Promise<TransactionalEmailResponse> {
    return this.send({
      recipients: recipients.map((r) => ({
        address: {
          email: r.email,
          name: r.name,
        },
        substitution_data: r.substitutions,
      })),
      content: {
        subject: content.subject,
        html: content.html,
        text: content.text,
        from: content.from,
      },
    });
  }
}
