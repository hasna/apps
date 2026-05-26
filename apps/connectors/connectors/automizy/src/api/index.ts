// Automizy Connector — Email marketing automation
import { AutomizyClient } from './client';
import type { AutomizyConfig, AZContact, AZContactList, AZSmartList, AZCampaign, AZAutomation, AZTag, AZForm } from '../types';
export { AutomizyClient } from './client';

export class Automizy {
  private readonly client: AutomizyClient;
  constructor(config: AutomizyConfig) { this.client = new AutomizyClient(config); }
  static fromEnv(): Automizy {
    const token = process.env.AUTOMIZY_TOKEN;
    if (!token) throw new Error('AUTOMIZY_TOKEN is required');
    return new Automizy({ token });
  }

  async listContacts(options?: { page?: number; limit?: number }): Promise<AZContactList> {
    return this.client.request<AZContactList>('/contacts', { params: { page: options?.page, limit: options?.limit } });
  }
  async getContact(contactId: number): Promise<AZContact> { return this.client.request<AZContact>(`/contacts/${contactId}`); }
  async createContact(data: { email: string; firstname?: string; lastname?: string; tags?: string[]; custom_fields?: Record<string, string> }): Promise<AZContact> {
    return this.client.request<AZContact>('/contacts', { method: 'POST', body: data as Record<string, unknown> });
  }
  async updateContact(contactId: number, data: { firstname?: string; lastname?: string; tags?: string[]; custom_fields?: Record<string, string> }): Promise<AZContact> {
    return this.client.request<AZContact>(`/contacts/${contactId}`, { method: 'PATCH', body: data as Record<string, unknown> });
  }
  async deleteContact(contactId: number): Promise<void> { await this.client.request(`/contacts/${contactId}`, { method: 'DELETE' }); }

  async listSmartLists(): Promise<AZSmartList[]> { return this.client.request<AZSmartList[]>('/smart-lists'); }
  async getSmartList(listId: number): Promise<AZSmartList> { return this.client.request<AZSmartList>(`/smart-lists/${listId}`); }

  async listCampaigns(): Promise<AZCampaign[]> { return this.client.request<AZCampaign[]>('/campaigns'); }
  async getCampaign(campaignId: number): Promise<AZCampaign> { return this.client.request<AZCampaign>(`/campaigns/${campaignId}`); }

  async listAutomations(): Promise<AZAutomation[]> { return this.client.request<AZAutomation[]>('/automations'); }
  async getAutomation(automationId: number): Promise<AZAutomation> { return this.client.request<AZAutomation>(`/automations/${automationId}`); }

  async listTags(): Promise<AZTag[]> { return this.client.request<AZTag[]>('/tags'); }
  async tagContact(contactId: number, tagName: string): Promise<void> { await this.client.request(`/contacts/${contactId}/tag`, { method: 'POST', body: { name: tagName } }); }
  async untagContact(contactId: number, tagName: string): Promise<void> { await this.client.request(`/contacts/${contactId}/untag`, { method: 'POST', body: { name: tagName } }); }

  async listForms(): Promise<AZForm[]> { return this.client.request<AZForm[]>('/forms'); }

  getClient(): AutomizyClient { return this.client; }
}
