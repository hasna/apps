// MailerLite Connector — Email marketing and automation platform
import { MailerLiteClient } from './client';
import type { MailerLiteConfig, MLSubscriber, MLSubscriberList, MLGroup, MLCampaign, MLAutomation, MLForm } from '../types';
export { MailerLiteClient } from './client';

export class MailerLite {
  private readonly client: MailerLiteClient;
  constructor(config: MailerLiteConfig) { this.client = new MailerLiteClient(config); }
  static fromEnv(): MailerLite {
    const apiKey = process.env.MAILERLITE_API_KEY;
    if (!apiKey) throw new Error('MAILERLITE_API_KEY is required');
    return new MailerLite({ apiKey });
  }

  async listSubscribers(options?: { page?: number; limit?: number; filter?: { status?: string } }): Promise<MLSubscriberList> {
    return this.client.request<MLSubscriberList>('/subscribers', { params: { page: options?.page, limit: options?.limit, 'filter[status]': options?.filter?.status } });
  }
  async getSubscriber(subscriberId: string): Promise<{ data: MLSubscriber }> { return this.client.request(`/subscribers/${subscriberId}`); }
  async createSubscriber(data: { email: string; fields?: Record<string, string>; groups?: string[] }): Promise<{ data: MLSubscriber }> {
    return this.client.request('/subscribers', { method: 'POST', body: data as Record<string, unknown> });
  }
  async updateSubscriber(subscriberId: string, data: { fields?: Record<string, string>; status?: string }): Promise<{ data: MLSubscriber }> {
    return this.client.request(`/subscribers/${subscriberId}`, { method: 'PUT', body: data as Record<string, unknown> });
  }
  async deleteSubscriber(subscriberId: string): Promise<void> { await this.client.request(`/subscribers/${subscriberId}`, { method: 'DELETE' }); }

  async listGroups(options?: { page?: number; limit?: number }): Promise<{ data: MLGroup[] }> {
    return this.client.request('/groups', { params: { page: options?.page, limit: options?.limit } });
  }
  async assignToGroup(groupId: string, subscriberId: string): Promise<void> {
    await this.client.request(`/subscribers/${subscriberId}/groups/${groupId}`, { method: 'POST' });
  }

  async listCampaigns(options?: { page?: number; filter?: { status?: string } }): Promise<{ data: MLCampaign[] }> {
    return this.client.request('/campaigns', { params: { page: options?.page, 'filter[status]': options?.filter?.status } });
  }

  async listAutomations(): Promise<{ data: MLAutomation[] }> { return this.client.request('/automations'); }
  async listForms(options?: { type?: string }): Promise<{ data: MLForm[] }> {
    return this.client.request('/forms', { params: { type: options?.type } });
  }

  getClient(): MailerLiteClient { return this.client; }
}
