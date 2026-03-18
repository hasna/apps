// Mailgun Connector — Email delivery API
import { MailgunClient } from './client';
import type { MailgunConfig, MGMessage, MGEventList, MGDomain, MGRoute, MGStats, MGSuppressionBounce } from '../types';
export { MailgunClient } from './client';

export class Mailgun {
  private readonly client: MailgunClient;
  constructor(config: MailgunConfig) { this.client = new MailgunClient(config); }
  static fromEnv(): Mailgun {
    const apiKey = process.env.MAILGUN_API_KEY;
    const domain = process.env.MAILGUN_DOMAIN;
    if (!apiKey || !domain) throw new Error('MAILGUN_API_KEY and MAILGUN_DOMAIN are required');
    return new Mailgun({ apiKey, domain, region: process.env.MAILGUN_REGION as 'us' | 'eu' | undefined });
  }

  async send(data: { from: string; to: string | string[]; subject: string; text?: string; html?: string; cc?: string; bcc?: string; 'o:tag'?: string[] }): Promise<MGMessage> {
    const to = Array.isArray(data.to) ? data.to.join(',') : data.to;
    return this.client.request<MGMessage>(`/${this.client.getDomain()}/messages`, { method: 'POST', body: { ...data, to } as Record<string, unknown>, form: true });
  }

  async listEvents(options?: { begin?: string; end?: string; event?: string; limit?: number }): Promise<MGEventList> {
    return this.client.request<MGEventList>(`/${this.client.getDomain()}/events`, { params: { begin: options?.begin, end: options?.end, event: options?.event, limit: options?.limit } });
  }

  async listDomains(): Promise<{ items: MGDomain[] }> { return this.client.request('/domains'); }
  async getDomain(domainName?: string): Promise<{ domain: MGDomain }> { return this.client.request(`/domains/${domainName || this.client.getDomain()}`); }
  async verifyDomain(domainName?: string): Promise<{ domain: MGDomain }> { return this.client.request(`/domains/${domainName || this.client.getDomain()}/verify`, { method: 'PUT' }); }

  async listRoutes(): Promise<{ items: MGRoute[] }> { return this.client.request('/routes'); }

  async getStats(options?: { event?: string; duration?: string }): Promise<{ items: MGStats[] }> {
    return this.client.request(`/${this.client.getDomain()}/stats/total`, { params: { event: options?.event || 'delivered', duration: options?.duration || '7d' } });
  }

  async listBounces(options?: { limit?: number }): Promise<{ items: MGSuppressionBounce[] }> {
    return this.client.request(`/${this.client.getDomain()}/bounces`, { params: { limit: options?.limit } });
  }
  async deleteBounce(address: string): Promise<void> { await this.client.request(`/${this.client.getDomain()}/bounces/${address}`, { method: 'DELETE' }); }

  async validateEmail(email: string): Promise<{ is_valid: boolean; reason: string; risk: string }> {
    return this.client.request('/v4/address/validate', { params: { address: email } });
  }

  getClient(): MailgunClient { return this.client; }
}
