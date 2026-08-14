// MoonMail Connector — Email marketing and campaign automation
import { MoonMailClient } from './client';
import type { MoonMailConfig, MMCampaign, MMList, MMSubscriber, MMSender } from '../types';
export { MoonMailClient } from './client';

export class MoonMail {
  private readonly client: MoonMailClient;
  constructor(config: MoonMailConfig) { this.client = new MoonMailClient(config); }
  static fromEnv(): MoonMail {
    const apiKey = process.env.MOONMAIL_API_KEY;
    if (!apiKey) throw new Error('MOONMAIL_API_KEY is required');
    return new MoonMail({ apiKey });
  }

  async listCampaigns(): Promise<MMCampaign[]> { return this.client.request<MMCampaign[]>('/campaigns'); }
  async getCampaign(campaignId: string): Promise<MMCampaign> { return this.client.request<MMCampaign>(`/campaigns/${campaignId}`); }
  async createCampaign(data: { name: string; subject: string; body: string; sender_id?: string; list_id?: string }): Promise<MMCampaign> {
    return this.client.request<MMCampaign>('/campaigns', { method: 'POST', body: data as Record<string, unknown> });
  }
  async sendCampaign(campaignId: string): Promise<void> { await this.client.request(`/campaigns/${campaignId}/send`, { method: 'POST' }); }

  async listLists(): Promise<MMList[]> { return this.client.request<MMList[]>('/lists'); }
  async getList(listId: string): Promise<MMList> { return this.client.request<MMList>(`/lists/${listId}`); }
  async createList(name: string): Promise<MMList> { return this.client.request<MMList>('/lists', { method: 'POST', body: { name } }); }

  async listSubscribers(listId: string, options?: { page?: number }): Promise<MMSubscriber[]> {
    return this.client.request<MMSubscriber[]>(`/lists/${listId}/subscribers`, { params: { page: options?.page } });
  }
  async addSubscriber(listId: string, email: string, metadata?: Record<string, string>): Promise<MMSubscriber> {
    return this.client.request<MMSubscriber>(`/lists/${listId}/subscribers`, { method: 'POST', body: { email, metadata } as Record<string, unknown> });
  }
  async removeSubscriber(listId: string, subscriberId: string): Promise<void> {
    await this.client.request(`/lists/${listId}/subscribers/${subscriberId}`, { method: 'DELETE' });
  }

  async listSenders(): Promise<MMSender[]> { return this.client.request<MMSender[]>('/senders'); }

  getClient(): MoonMailClient { return this.client; }
}
