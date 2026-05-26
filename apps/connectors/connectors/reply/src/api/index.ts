// Reply Connector — Sales engagement platform for multi-channel outreach
import { ReplyClient } from './client';
import type { ReplyConfig, ReplyCampaign, ReplyContact, ReplyContactList, ReplySequenceStep, ReplyEmailAccount, ReplyStats } from '../types';
export { ReplyClient } from './client';

export class Reply {
  private readonly client: ReplyClient;
  constructor(config: ReplyConfig) { this.client = new ReplyClient(config); }
  static fromEnv(): Reply {
    const apiKey = process.env.REPLY_API_KEY;
    if (!apiKey) throw new Error('REPLY_API_KEY is required');
    return new Reply({ apiKey });
  }

  async listCampaigns(): Promise<ReplyCampaign[]> { return this.client.request<ReplyCampaign[]>('/campaigns'); }
  async getCampaign(campaignId: number): Promise<ReplyCampaign> { return this.client.request<ReplyCampaign>(`/campaigns/${campaignId}`); }
  async getCampaignSteps(campaignId: number): Promise<ReplySequenceStep[]> { return this.client.request<ReplySequenceStep[]>(`/campaigns/${campaignId}/steps`); }
  async getCampaignStats(campaignId: number): Promise<ReplyStats> { return this.client.request<ReplyStats>(`/campaigns/${campaignId}/stats`); }

  async listContacts(options?: { page?: number; campaign_id?: number; status?: string }): Promise<ReplyContactList> {
    return this.client.request<ReplyContactList>('/people', { params: { page: options?.page, campaign_id: options?.campaign_id, status: options?.status } });
  }
  async getContact(contactId: number): Promise<ReplyContact> { return this.client.request<ReplyContact>(`/people/${contactId}`); }
  async createContact(data: { email: string; first_name?: string; last_name?: string; company?: string; title?: string; phone?: string; campaign_id?: number }): Promise<ReplyContact> {
    return this.client.request<ReplyContact>('/people', { method: 'POST', body: data as Record<string, unknown> });
  }
  async updateContact(contactId: number, data: { first_name?: string; last_name?: string; company?: string; title?: string }): Promise<ReplyContact> {
    return this.client.request<ReplyContact>(`/people/${contactId}`, { method: 'PATCH', body: data as Record<string, unknown> });
  }
  async deleteContact(contactId: number): Promise<void> { await this.client.request(`/people/${contactId}`, { method: 'DELETE' }); }
  async addContactToCampaign(contactId: number, campaignId: number): Promise<void> {
    await this.client.request(`/people/${contactId}/campaigns`, { method: 'POST', body: { campaign_id: campaignId } });
  }

  async listEmailAccounts(): Promise<ReplyEmailAccount[]> { return this.client.request<ReplyEmailAccount[]>('/emailAccounts'); }

  getClient(): ReplyClient { return this.client; }
}
