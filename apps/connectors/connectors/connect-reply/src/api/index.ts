// Reply.io Connector
// Sales engagement — contacts, campaigns, email sequences

import { ReplyClient } from './client';
import type { ReplyConfig, Person, Campaign, EmailAccount, Task } from '../types';

export { ReplyClient } from './client';

export class Reply {
  private readonly client: ReplyClient;

  constructor(config: ReplyConfig) {
    this.client = new ReplyClient(config);
  }

  static fromEnv(): Reply {
    const apiKey = process.env.REPLY_API_KEY;
    if (!apiKey) throw new Error('REPLY_API_KEY environment variable is required');
    return new Reply({ apiKey });
  }

  // People (contacts)
  async listPeople(options?: { page?: number; limit?: number; campaignId?: number }): Promise<{ people: Person[]; total: number }> {
    return this.client.request('/people', { params: options as Record<string, number | undefined> });
  }

  async getPerson(personId: number): Promise<Person> {
    return this.client.request<Person>(`/people/${personId}`);
  }

  async getPersonByEmail(email: string): Promise<Person> {
    return this.client.request<Person>('/people/get', { params: { email } });
  }

  async createPerson(data: {
    firstName: string;
    lastName: string;
    email: string;
    company?: string;
    title?: string;
    phone?: string;
    customFields?: Record<string, string>;
  }): Promise<{ id: number }> {
    return this.client.request('/people', { method: 'POST', body: data as Record<string, unknown> });
  }

  async updatePerson(personId: number, data: Partial<Parameters<Reply['createPerson']>[0]>): Promise<void> {
    await this.client.request(`/people/${personId}`, { method: 'PUT', body: data as Record<string, unknown> });
  }

  async deletePerson(personId: number): Promise<void> {
    await this.client.request(`/people/${personId}`, { method: 'DELETE' });
  }

  async pushPersonToCampaign(personId: number, campaignId: number): Promise<void> {
    await this.client.request('/people/pushtosequence', {
      method: 'POST',
      body: { personId, campaignId },
    });
  }

  async removePersonFromCampaign(personId: number, campaignId: number): Promise<void> {
    await this.client.request('/people/removefromsequence', {
      method: 'POST',
      body: { personId, campaignId },
    });
  }

  // Campaigns (sequences)
  async listCampaigns(options?: { page?: number; limit?: number }): Promise<{ campaigns: Campaign[]; total: number }> {
    return this.client.request('/campaigns', { params: options as Record<string, number | undefined> });
  }

  async getCampaign(campaignId: number): Promise<Campaign> {
    return this.client.request<Campaign>(`/campaigns/${campaignId}`);
  }

  async startCampaign(campaignId: number): Promise<void> {
    await this.client.request(`/campaigns/${campaignId}/start`, { method: 'PUT' });
  }

  async pauseCampaign(campaignId: number): Promise<void> {
    await this.client.request(`/campaigns/${campaignId}/pause`, { method: 'PUT' });
  }

  // Email Accounts
  async listEmailAccounts(): Promise<EmailAccount[]> {
    const result = await this.client.request<{ emailAccounts: EmailAccount[] }>('/emailaccounts');
    return result.emailAccounts;
  }

  // Tasks
  async listTasks(options?: { page?: number; limit?: number; type?: string }): Promise<{ tasks: Task[]; total: number }> {
    return this.client.request('/tasks', { params: options as Record<string, string | number | undefined> });
  }

  getClient(): ReplyClient { return this.client; }
}
