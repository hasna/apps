// Engati Connector — Conversational AI chatbot and automation
import { EngatiClient } from './client';
import type { EngatiConfig, ENBot, ENConversation, ENCustomer, ENCustomerList, ENBroadcast } from '../types';
export { EngatiClient } from './client';

export class Engati {
  private readonly client: EngatiClient;
  constructor(config: EngatiConfig) { this.client = new EngatiClient(config); }
  static fromEnv(): Engati {
    const apiKey = process.env.ENGATI_API_KEY;
    const botKey = process.env.ENGATI_BOT_KEY;
    if (!apiKey || !botKey) throw new Error('ENGATI_API_KEY and ENGATI_BOT_KEY are required');
    return new Engati({ apiKey, botKey });
  }

  async getBot(): Promise<ENBot> { return this.client.request<ENBot>('/bot'); }

  async sendMessage(customerId: string, message: string, channel?: string): Promise<void> {
    await this.client.request('/messages/send', { method: 'POST', body: { customer_id: customerId, message, channel } });
  }

  async listConversations(options?: { status?: string; page?: number }): Promise<{ conversations: ENConversation[] }> {
    return this.client.request('/conversations', { params: { status: options?.status, page: options?.page } });
  }
  async getConversation(conversationId: string): Promise<ENConversation> {
    return this.client.request<ENConversation>(`/conversations/${conversationId}`);
  }

  async listCustomers(options?: { page?: number; per_page?: number; tag?: string }): Promise<ENCustomerList> {
    return this.client.request<ENCustomerList>('/customers', { params: { page: options?.page, per_page: options?.per_page, tag: options?.tag } });
  }
  async getCustomer(customerId: string): Promise<ENCustomer> { return this.client.request<ENCustomer>(`/customers/${customerId}`); }
  async updateCustomer(customerId: string, data: { name?: string; email?: string; tags?: string[]; custom_attributes?: Record<string, unknown> }): Promise<ENCustomer> {
    return this.client.request<ENCustomer>(`/customers/${customerId}`, { method: 'PUT', body: data as Record<string, unknown> });
  }

  async listBroadcasts(): Promise<ENBroadcast[]> { return this.client.request<ENBroadcast[]>('/broadcasts'); }

  getClient(): EngatiClient { return this.client; }
}
