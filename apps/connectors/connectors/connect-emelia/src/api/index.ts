// Emelia Connector — Cold email outreach and automation
import { EmeliaClient } from './client';
import type { EmeliaConfig, EmCampaign, EmContact, EmEmailAccount } from '../types';
export { EmeliaClient } from './client';

export class Emelia {
  private readonly client: EmeliaClient;
  constructor(config: EmeliaConfig) { this.client = new EmeliaClient(config); }

  static fromEnv(): Emelia {
    const apiKey = process.env.EMELIA_API_KEY;
    if (!apiKey) throw new Error('EMELIA_API_KEY environment variable is required');
    return new Emelia({ apiKey });
  }

  // Campaigns
  async listCampaigns(): Promise<EmCampaign[]> {
    const r = await this.client.request<{ campaigns: EmCampaign[] }>('/campaigns');
    return r.campaigns ?? [];
  }
  async getCampaign(campaignId: string): Promise<EmCampaign> {
    return this.client.request<EmCampaign>(`/campaigns/${campaignId}`);
  }
  async startCampaign(campaignId: string): Promise<void> {
    await this.client.request(`/campaigns/${campaignId}/start`, { method: 'POST' });
  }
  async pauseCampaign(campaignId: string): Promise<void> {
    await this.client.request(`/campaigns/${campaignId}/pause`, { method: 'POST' });
  }

  // Contacts
  async listContacts(campaignId: string, options?: { page?: number; limit?: number }): Promise<EmContact[]> {
    const r = await this.client.request<{ contacts: EmContact[] }>(`/campaigns/${campaignId}/contacts`, {
      params: options as Record<string, number | undefined>,
    });
    return r.contacts ?? [];
  }
  async addContact(campaignId: string, contact: {
    email: string;
    firstName?: string;
    lastName?: string;
    companyName?: string;
    customFields?: Record<string, string>;
  }): Promise<EmContact> {
    return this.client.request<EmContact>(`/campaigns/${campaignId}/contacts`, {
      method: 'POST',
      body: contact as Record<string, unknown>,
    });
  }
  async addContacts(campaignId: string, contacts: Array<{ email: string; firstName?: string; lastName?: string; companyName?: string }>): Promise<{ added: number; skipped: number }> {
    return this.client.request(`/campaigns/${campaignId}/contacts/bulk`, {
      method: 'POST',
      body: { contacts },
    });
  }
  async removeContact(campaignId: string, contactId: string): Promise<void> {
    await this.client.request(`/campaigns/${campaignId}/contacts/${contactId}`, { method: 'DELETE' });
  }
  async unsubscribeContact(email: string): Promise<void> {
    await this.client.request('/unsubscribe', { method: 'POST', body: { email } });
  }

  // Email Accounts
  async listEmailAccounts(): Promise<EmEmailAccount[]> {
    const r = await this.client.request<{ emailAccounts: EmEmailAccount[] }>('/email-accounts');
    return r.emailAccounts ?? [];
  }

  getClient(): EmeliaClient { return this.client; }
}
