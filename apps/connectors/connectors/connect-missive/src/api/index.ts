// Missive Connector — Team inbox and collaborative email
import { MissiveClient } from './client';
import type { MissiveConfig, MVConversation, MVConversationList, MVMessage, MVContact, MVContactList, MVLabel, MVOrganization, MVUser } from '../types';
export { MissiveClient } from './client';

export class Missive {
  private readonly client: MissiveClient;
  constructor(config: MissiveConfig) { this.client = new MissiveClient(config); }
  static fromEnv(): Missive {
    const token = process.env.MISSIVE_TOKEN;
    if (!token) throw new Error('MISSIVE_TOKEN is required');
    return new Missive({ token });
  }

  async listConversations(options?: { label_id?: string; assignee_id?: string; organization_id?: string; limit?: number }): Promise<MVConversationList> {
    return this.client.request<MVConversationList>('/conversations', { params: { label: options?.label_id, assignee: options?.assignee_id, organization: options?.organization_id, limit: options?.limit } });
  }
  async getConversation(conversationId: string): Promise<{ conversation: MVConversation }> { return this.client.request(`/conversations/${conversationId}`); }

  async listMessages(conversationId: string): Promise<{ messages: MVMessage[] }> {
    return this.client.request(`/conversations/${conversationId}/messages`);
  }
  async sendMessage(data: { conversation_id?: string; to_fields: { address: string; name?: string }[]; subject?: string; body: string; from_field?: { address: string; name?: string } }): Promise<{ message: MVMessage }> {
    return this.client.request('/messages', { method: 'POST', body: data as Record<string, unknown> });
  }

  async listContacts(options?: { limit?: number; organization_id?: string }): Promise<MVContactList> {
    return this.client.request<MVContactList>('/contacts', { params: { limit: options?.limit, organization: options?.organization_id } });
  }
  async getContact(contactId: string): Promise<{ contact: MVContact }> { return this.client.request(`/contacts/${contactId}`); }
  async createContact(data: { name?: string; email?: string; phone?: string; organization?: string }): Promise<{ contact: MVContact }> {
    return this.client.request('/contacts', { method: 'POST', body: data as Record<string, unknown> });
  }

  async listLabels(): Promise<{ labels: MVLabel[] }> { return this.client.request('/labels'); }
  async listOrganizations(): Promise<{ organizations: MVOrganization[] }> { return this.client.request('/organizations'); }
  async listUsers(): Promise<{ users: MVUser[] }> { return this.client.request('/users'); }

  async assignConversation(conversationId: string, assigneeIds: string[]): Promise<void> {
    await this.client.request(`/conversations/${conversationId}`, { method: 'PATCH', body: { conversation: { assignee_ids: assigneeIds } } });
  }

  getClient(): MissiveClient { return this.client; }
}
