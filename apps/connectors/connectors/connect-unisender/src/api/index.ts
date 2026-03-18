// UniSender Connector — Email and SMS marketing platform
import { UniSenderClient } from './client';
import type { UniSenderConfig, USList, USCampaign, USCampaignStats, USMessage, USField } from '../types';
export { UniSenderClient } from './client';

export class UniSender {
  private readonly client: UniSenderClient;
  constructor(config: UniSenderConfig) { this.client = new UniSenderClient(config); }
  static fromEnv(): UniSender {
    const apiKey = process.env.UNISENDER_API_KEY;
    if (!apiKey) throw new Error('UNISENDER_API_KEY is required');
    return new UniSender({ apiKey });
  }

  async getLists(): Promise<USList[]> { return this.client.request<USList[]>('getLists'); }
  async createList(title: string, options?: { before_subscribe_url?: string; after_subscribe_url?: string }): Promise<{ id: number }> {
    return this.client.request('createList', { title, ...options });
  }
  async deleteList(listId: number): Promise<void> { await this.client.request('deleteList', { list_id: listId }); }

  async subscribe(listIds: number[], email: string, fields?: Record<string, string>): Promise<{ person_id: number }> {
    const params: Record<string, string | number> = { list_ids: listIds.join(','), 'fields[email]': email };
    if (fields) Object.entries(fields).forEach(([k, v]) => { params[`fields[${k}]`] = v; });
    return this.client.request('subscribe', params);
  }
  async unsubscribe(email: string): Promise<void> { await this.client.request('unsubscribe', { contact: email, contact_type: 'email' }); }

  async createEmailMessage(data: { sender_name: string; sender_email: string; subject: string; body: string; list_id: number }): Promise<{ message_id: number }> {
    return this.client.request('createEmailMessage', data as Record<string, string | number>);
  }
  async createCampaign(messageId: number): Promise<{ campaign_id: number; status: string }> {
    return this.client.request('createCampaign', { message_id: messageId });
  }
  async getCampaignStatus(campaignId: number): Promise<USCampaignStats> {
    return this.client.request<USCampaignStats>('getCampaignStatus', { campaign_id: campaignId });
  }

  async getFields(): Promise<USField[]> { return this.client.request<USField[]>('getFields'); }
  async createField(name: string, type: string): Promise<{ id: number }> { return this.client.request('createField', { name, type }); }

  async sendSms(phone: string, text: string, sender?: string): Promise<{ sms_id: number }> {
    return this.client.request('sendSms', { phone, text, sender });
  }

  getClient(): UniSenderClient { return this.client; }
}
