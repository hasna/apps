import { Smtp2goClient } from './client';
import type {
  Smtp2goConfig,
  SendEmailParams,
  SendEmailResult,
  SendMimeParams,
  EmailSearchParams,
  EmailSearchResult,
  ActivitySearchParams,
  ActivitySearchResult,
  StatsDateRange,
  StatsSummary,
  StatsBounces,
  StatsCycle,
  StatsHistory,
  StatsSpam,
  StatsUnsubscribes,
  SuppressionListResult,
  SuppressionMutationResult,
  DomainListResult,
  DomainResult,
  SingleSenderListResult,
  SmtpUserListResult,
  SmtpUserCreateParams,
  SmtpUserUpdateParams,
} from '../types';

export { Smtp2goClient };

/**
 * High-level wrapper over the SMTP2GO v3 API.
 *
 * Only endpoints documented at https://developers.smtp2go.com/ are exposed.
 */
export class Smtp2go {
  private readonly client: Smtp2goClient;

  constructor(config: Smtp2goConfig) {
    this.client = new Smtp2goClient(config);
  }

  /** Create a client from the SMTP2GO_API_KEY environment variable. */
  static fromEnv(): Smtp2go {
    const apiKey = process.env.SMTP2GO_API_KEY;
    if (!apiKey) {
      throw new Error('SMTP2GO_API_KEY environment variable is required');
    }
    return new Smtp2go({ apiKey, baseUrl: process.env.CONNECTOR_BASE_URL });
  }

  /** Access the underlying transport for endpoints not wrapped here. */
  getClient(): Smtp2goClient {
    return this.client;
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  // ============================================
  // Email
  // ============================================

  /** Send an email by passing a structured email object. */
  async sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
    return this.client.post<SendEmailResult>('/email/send', params as unknown as Record<string, unknown>);
  }

  /**
   * Send a simple email (convenience wrapper over sendEmail).
   */
  async sendSimpleEmail(options: {
    to: string | string[];
    sender: string;
    subject: string;
    text?: string;
    html?: string;
    cc?: string | string[];
    bcc?: string | string[];
  }): Promise<SendEmailResult> {
    const toArray = (v?: string | string[]): string[] | undefined =>
      v === undefined ? undefined : Array.isArray(v) ? v : [v];

    return this.sendEmail({
      sender: options.sender,
      to: toArray(options.to) ?? [],
      cc: toArray(options.cc),
      bcc: toArray(options.bcc),
      subject: options.subject,
      text_body: options.text,
      html_body: options.html,
    });
  }

  /** Send an email using a pre-encoded MIME string. */
  async sendMime(params: SendMimeParams): Promise<SendEmailResult> {
    return this.client.post<SendEmailResult>('/email/mime', params as unknown as Record<string, unknown>);
  }

  /** Search previously sent emails. */
  async searchEmails(params: EmailSearchParams = {}): Promise<EmailSearchResult> {
    return this.client.post<EmailSearchResult>('/email/search', params as Record<string, unknown>);
  }

  // ============================================
  // Activity
  // ============================================

  /** Search the activity stream for delivery/engagement events. */
  async searchActivity(params: ActivitySearchParams = {}): Promise<ActivitySearchResult> {
    return this.client.post<ActivitySearchResult>('/activity/search', params as Record<string, unknown>);
  }

  // ============================================
  // Statistics
  // ============================================

  async statsSummary(range: StatsDateRange = {}): Promise<StatsSummary> {
    return this.client.post<StatsSummary>('/stats/email_summary', range as Record<string, unknown>);
  }

  async statsBounces(range: StatsDateRange = {}): Promise<StatsBounces> {
    return this.client.post<StatsBounces>('/stats/email_bounces', range as Record<string, unknown>);
  }

  async statsCycle(range: StatsDateRange = {}): Promise<StatsCycle> {
    return this.client.post<StatsCycle>('/stats/email_cycle', range as Record<string, unknown>);
  }

  async statsHistory(range: StatsDateRange = {}): Promise<StatsHistory> {
    return this.client.post<StatsHistory>('/stats/email_history', range as Record<string, unknown>);
  }

  async statsSpam(range: StatsDateRange = {}): Promise<StatsSpam> {
    return this.client.post<StatsSpam>('/stats/email_spam', range as Record<string, unknown>);
  }

  async statsUnsubscribes(range: StatsDateRange = {}): Promise<StatsUnsubscribes> {
    return this.client.post<StatsUnsubscribes>('/stats/email_unsubscribes', range as Record<string, unknown>);
  }

  // ============================================
  // Suppressions
  // ============================================

  async listSuppressions(): Promise<SuppressionListResult> {
    return this.client.post<SuppressionListResult>('/suppression/view');
  }

  async addSuppressions(emails: string[]): Promise<SuppressionMutationResult> {
    return this.client.post<SuppressionMutationResult>('/suppression/add', { suppressions: emails });
  }

  async removeSuppressions(emails: string[]): Promise<SuppressionMutationResult> {
    return this.client.post<SuppressionMutationResult>('/suppression/remove', { suppressions: emails });
  }

  // ============================================
  // Sender domains
  // ============================================

  async listDomains(): Promise<DomainListResult> {
    return this.client.post<DomainListResult>('/domain/view');
  }

  async addDomain(domain: string): Promise<DomainResult> {
    return this.client.post<DomainResult>('/domain/add', { domain });
  }

  async verifyDomain(domain: string): Promise<DomainResult> {
    return this.client.post<DomainResult>('/domain/verify', { domain });
  }

  async removeDomain(domain: string): Promise<DomainResult> {
    return this.client.post<DomainResult>('/domain/remove', { domain });
  }

  // ============================================
  // Single senders
  // ============================================

  async listSingleSenders(): Promise<SingleSenderListResult> {
    return this.client.post<SingleSenderListResult>('/single_sender/view');
  }

  async addSingleSender(email: string): Promise<Record<string, unknown>> {
    return this.client.post<Record<string, unknown>>('/single_sender/add', { email });
  }

  async removeSingleSender(email: string): Promise<Record<string, unknown>> {
    return this.client.post<Record<string, unknown>>('/single_sender/remove', { email });
  }

  // ============================================
  // SMTP users
  // ============================================

  async listSmtpUsers(): Promise<SmtpUserListResult> {
    return this.client.post<SmtpUserListResult>('/user/smtp/view');
  }

  async addSmtpUser(params: SmtpUserCreateParams): Promise<Record<string, unknown>> {
    return this.client.post<Record<string, unknown>>('/user/smtp/add', params as unknown as Record<string, unknown>);
  }

  async editSmtpUser(params: SmtpUserUpdateParams): Promise<Record<string, unknown>> {
    return this.client.post<Record<string, unknown>>('/user/smtp/edit', params as unknown as Record<string, unknown>);
  }

  async removeSmtpUser(username: string): Promise<Record<string, unknown>> {
    return this.client.post<Record<string, unknown>>('/user/smtp/remove', { username });
  }
}
