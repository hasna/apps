// Textmagic Connector — Business SMS platform

import { TextmagicClient } from './client';
import type { TextmagicConfig, TextmagicMessage, SendMessageResult, Contact, TextmagicAccount } from '../types';

export { TextmagicClient } from './client';

export class Textmagic {
  private readonly client: TextmagicClient;

  constructor(config: TextmagicConfig) {
    this.client = new TextmagicClient(config);
  }

  static fromEnv(): Textmagic {
    const username = process.env.TEXTMAGIC_USERNAME;
    const apiKey = process.env.TEXTMAGIC_API_KEY;
    if (!username || !apiKey) throw new Error('TEXTMAGIC_USERNAME and TEXTMAGIC_API_KEY are required');
    return new Textmagic({ username, apiKey });
  }

  async getAccount(): Promise<TextmagicAccount> {
    return this.client.request<TextmagicAccount>('/user');
  }

  async sendMessage(options: { text: string; phones?: string[]; contacts?: number[]; lists?: number[]; sendingTime?: string }): Promise<SendMessageResult> {
    return this.client.request<SendMessageResult>('/messages', {
      method: 'POST',
      body: {
        text: options.text,
        phones: options.phones?.join(','),
        contacts: options.contacts?.join(','),
        lists: options.lists?.join(','),
        sendingTime: options.sendingTime,
      },
    });
  }

  async listMessages(options?: { page?: number; limit?: number; query?: string }): Promise<{ resources: TextmagicMessage[]; page: number; pageCount: number; limit: number; totalCount: number }> {
    return this.client.request('/messages', { params: options as Record<string, number | string | undefined> });
  }

  async getMessage(messageId: number): Promise<TextmagicMessage> {
    return this.client.request<TextmagicMessage>(`/messages/${messageId}`);
  }

  async deleteMessage(messageId: number): Promise<void> {
    await this.client.request(`/messages/${messageId}`, { method: 'DELETE' });
  }

  async listContacts(options?: { page?: number; limit?: number; search?: string }): Promise<{ resources: Contact[] }> {
    return this.client.request('/contacts', { params: options as Record<string, string | number | undefined> });
  }

  async getContact(contactId: number): Promise<Contact> {
    return this.client.request<Contact>(`/contacts/${contactId}`);
  }

  async createContact(data: { phone: string; firstName?: string; lastName?: string; email?: string; companyName?: string }): Promise<{ id: number; href: string }> {
    return this.client.request('/contacts', { method: 'POST', body: data as Record<string, unknown> });
  }

  async updateContact(contactId: number, data: Partial<Parameters<Textmagic['createContact']>[0]>): Promise<void> {
    await this.client.request(`/contacts/${contactId}`, { method: 'PUT', body: data as Record<string, unknown> });
  }

  async deleteContact(contactId: number): Promise<void> {
    await this.client.request(`/contacts/${contactId}`, { method: 'DELETE' });
  }

  getClient(): TextmagicClient { return this.client; }
}
