// Smaily Connector — Email marketing automation and newsletter platform
import { SmailyClient } from './client';
import type { SmailyConfig, SMCampaign, SMSubscriber, SMSubscriberList, SMAutoresponder, SMSegment } from '../types';
export { SmailyClient } from './client';

export class Smaily {
  private readonly client: SmailyClient;
  constructor(config: SmailyConfig) { this.client = new SmailyClient(config); }
  static fromEnv(): Smaily {
    const subdomain = process.env.SMAILY_SUBDOMAIN;
    const username = process.env.SMAILY_USERNAME;
    const password = process.env.SMAILY_PASSWORD;
    if (!subdomain || !username || !password) throw new Error('SMAILY_SUBDOMAIN, SMAILY_USERNAME, and SMAILY_PASSWORD are required');
    return new Smaily({ subdomain, username, password });
  }

  async listCampaigns(): Promise<SMCampaign[]> { return this.client.request<SMCampaign[]>('/campaigns.php'); }

  async listSubscribers(options?: { page?: number; limit?: number; segment_id?: number }): Promise<SMSubscriberList> {
    return this.client.request<SMSubscriberList>('/contact.php', { params: { page: options?.page, limit: options?.limit, list: options?.segment_id } });
  }
  async addSubscriber(email: string, fields?: Record<string, string>): Promise<{ code: number }> {
    return this.client.request('/contact.php', { method: 'POST', body: { email, ...fields } });
  }
  async updateSubscriber(email: string, fields: Record<string, string>): Promise<{ code: number }> {
    return this.client.request('/contact.php', { method: 'POST', body: { email, is_update: true, ...fields } as Record<string, unknown> });
  }
  async unsubscribe(email: string): Promise<{ code: number }> {
    return this.client.request('/contact.php', { method: 'POST', body: { email, is_unsubscribed: 1 } as Record<string, unknown> });
  }

  async listAutoresponders(): Promise<SMAutoresponder[]> { return this.client.request<SMAutoresponder[]>('/autoresponder.php'); }
  async listSegments(): Promise<SMSegment[]> { return this.client.request<SMSegment[]>('/list.php'); }

  getClient(): SmailyClient { return this.client; }
}
