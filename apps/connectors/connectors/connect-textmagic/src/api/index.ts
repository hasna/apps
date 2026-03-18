// Textmagic Connector — Business SMS platform for bulk messaging
import { TextmagicClient } from './client';
import type { TextmagicConfig, TMMessage, TMMessageList, TMContact, TMContactList, TMList, TMTemplate } from '../types';
export { TextmagicClient } from './client';

export class Textmagic {
  private readonly client: TextmagicClient;
  constructor(config: TextmagicConfig) { this.client = new TextmagicClient(config); }
  static fromEnv(): Textmagic {
    const username = process.env.TEXTMAGIC_USERNAME;
    const apiKey = process.env.TEXTMAGIC_API_KEY;
    if (!username || !apiKey) throw new Error('TEXTMAGIC_USERNAME and TEXTMAGIC_API_KEY are required');
    return new Textmagic({ username, apiKey });
  }

  async sendMessage(phones: string, text: string): Promise<{ id: number; href: string }> {
    return this.client.request('/messages', { method: 'POST', body: { phones, text } });
  }
  async getMessage(messageId: number): Promise<TMMessage> { return this.client.request<TMMessage>(`/messages/${messageId}`); }
  async listMessages(options?: { page?: number; limit?: number }): Promise<TMMessageList> {
    return this.client.request<TMMessageList>('/messages', { params: { page: options?.page, limit: options?.limit } });
  }
  async deleteMessage(messageId: number): Promise<void> { await this.client.request(`/messages/${messageId}`, { method: 'DELETE' }); }

  async listContacts(options?: { page?: number; limit?: number }): Promise<TMContactList> {
    return this.client.request<TMContactList>('/contacts', { params: { page: options?.page, limit: options?.limit } });
  }
  async getContact(contactId: number): Promise<TMContact> { return this.client.request<TMContact>(`/contacts/${contactId}`); }
  async createContact(data: { phone: string; firstName?: string; lastName?: string; email?: string; companyName?: string }): Promise<{ id: number; href: string }> {
    return this.client.request('/contacts', { method: 'POST', body: data as Record<string, unknown> });
  }
  async deleteContact(contactId: number): Promise<void> { await this.client.request(`/contacts/${contactId}`, { method: 'DELETE' }); }

  async listLists(options?: { page?: number; limit?: number }): Promise<{ page: number; resources: TMList[] }> {
    return this.client.request('/lists', { params: { page: options?.page, limit: options?.limit } });
  }

  async listTemplates(): Promise<{ page: number; resources: TMTemplate[] }> { return this.client.request('/templates'); }
  async getTemplate(templateId: number): Promise<TMTemplate> { return this.client.request<TMTemplate>(`/templates/${templateId}`); }

  getClient(): TextmagicClient { return this.client; }
}
