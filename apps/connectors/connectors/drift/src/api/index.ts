// Drift Connector — Conversational marketing and sales
import { DriftClient } from './client';
import type { DriftConfig, DriftContact, DriftConversation, DriftMessage, DriftUser } from '../types';
export { DriftClient } from './client';

export class Drift {
  private readonly client: DriftClient;
  constructor(config: DriftConfig) { this.client = new DriftClient(config); }
  static fromEnv(): Drift {
    const accessToken = process.env.DRIFT_ACCESS_TOKEN;
    if (!accessToken) throw new Error('DRIFT_ACCESS_TOKEN environment variable is required');
    return new Drift({ accessToken });
  }

  async listContacts(options?: { limit?: number; cursor?: string }): Promise<{ data: DriftContact[]; pagination?: { next?: string } }> {
    return this.client.request('/contacts', { params: options as Record<string, string | number | undefined> });
  }
  async getContact(contactId: number): Promise<{ data: DriftContact }> {
    return this.client.request(`/contacts/${contactId}`);
  }
  async createContact(email: string, attributes?: Record<string, unknown>): Promise<{ data: DriftContact }> {
    return this.client.request('/contacts', { method: 'POST', body: { attributes: { email, ...attributes } } });
  }
  async deleteContact(contactId: number): Promise<void> {
    await this.client.request(`/contacts/${contactId}`, { method: 'DELETE' });
  }

  async listConversations(options?: { limit?: number; next?: string }): Promise<{ data: DriftConversation[]; pagination?: { next?: string } }> {
    return this.client.request('/conversations', { params: options as Record<string, string | number | undefined> });
  }
  async getConversation(conversationId: number): Promise<{ data: DriftConversation }> {
    return this.client.request(`/conversations/${conversationId}`);
  }

  async listMessages(conversationId: number): Promise<{ data: DriftMessage[] }> {
    return this.client.request(`/conversations/${conversationId}/messages`);
  }
  async sendMessage(conversationId: number, body: string, type?: 'chat' | 'private_note'): Promise<{ data: DriftMessage }> {
    return this.client.request(`/conversations/${conversationId}/messages`, { method: 'POST', body: { body, type: type || 'chat' } });
  }

  async listUsers(): Promise<{ data: DriftUser[] }> {
    return this.client.request('/users/list');
  }
  async getUser(userId: number): Promise<{ data: DriftUser }> {
    return this.client.request(`/users/${userId}`);
  }

  getClient(): DriftClient { return this.client; }
}
