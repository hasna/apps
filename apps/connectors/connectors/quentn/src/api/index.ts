// Quentn Connector — Marketing automation and CRM for email and sales funnels
import { QuentnClient } from './client';
import type { QuentnConfig, QNContact, QNContactList, QNTag, QNCampaign, QNTerm, QNCustomField } from '../types';
export { QuentnClient } from './client';

export class Quentn {
  private readonly client: QuentnClient;
  constructor(config: QuentnConfig) { this.client = new QuentnClient(config); }
  static fromEnv(): Quentn {
    const apiKey = process.env.QUENTN_API_KEY;
    if (!apiKey) throw new Error('QUENTN_API_KEY is required');
    return new Quentn({ apiKey, baseUrl: process.env.QUENTN_BASE_URL });
  }

  async listContacts(options?: { offset?: number; limit?: number; search?: string }): Promise<QNContactList> {
    return this.client.request<QNContactList>('/contacts', { params: { offset: options?.offset, limit: options?.limit, search: options?.search } });
  }
  async getContact(contactId: number): Promise<QNContact> { return this.client.request<QNContact>(`/contacts/${contactId}`); }
  async createContact(data: { mail: string; first_name?: string; last_name?: string; company?: string; tags?: number[] }): Promise<{ id: number }> {
    return this.client.request('/contacts', { method: 'POST', body: data as Record<string, unknown> });
  }
  async updateContact(contactId: number, data: { first_name?: string; last_name?: string; company?: string; tags?: number[] }): Promise<void> {
    await this.client.request(`/contacts/${contactId}`, { method: 'PUT', body: data as Record<string, unknown> });
  }
  async deleteContact(contactId: number): Promise<void> { await this.client.request(`/contacts/${contactId}`, { method: 'DELETE' }); }
  async addTagToContact(contactId: number, tagId: number): Promise<void> {
    await this.client.request(`/contacts/${contactId}/tags/${tagId}`, { method: 'POST' });
  }
  async removeTagFromContact(contactId: number, tagId: number): Promise<void> {
    await this.client.request(`/contacts/${contactId}/tags/${tagId}`, { method: 'DELETE' });
  }

  async listTags(): Promise<QNTag[]> { return this.client.request<QNTag[]>('/tags'); }
  async createTag(name: string, description?: string): Promise<{ id: number }> {
    return this.client.request('/tags', { method: 'POST', body: { name, description } });
  }

  async listTerms(): Promise<QNTerm[]> { return this.client.request<QNTerm[]>('/terms'); }
  async listCustomFields(): Promise<QNCustomField[]> { return this.client.request<QNCustomField[]>('/custom-fields'); }

  getClient(): QuentnClient { return this.client; }
}
