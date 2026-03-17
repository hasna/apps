import type { ConnectorClient } from './client';
import type { Contact, ContactCreateParams, ContactUpdateParams, ListParams } from '../types';

export class ContactsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<unknown> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.limit) queryParams.limit = params.limit;
    if (params?.offset) queryParams.offset = params.offset;
    if (params?.filters) {
      for (const [key, value] of Object.entries(params.filters)) {
        queryParams[key] = value;
      }
    }
    return this.client.get<unknown>('/contacts', queryParams);
  }

  async get(contactId: string): Promise<{ contact: Contact }> {
    return this.client.get<{ contact: Contact }>(`/contacts/${contactId}`);
  }

  async create(params: ContactCreateParams): Promise<{ contact: Contact }> {
    return this.client.post<{ contact: Contact }>('/contacts', { contact: params });
  }

  async update(contactId: string, params: ContactUpdateParams): Promise<{ contact: Contact }> {
    return this.client.put<{ contact: Contact }>(`/contacts/${contactId}`, { contact: params });
  }

  async delete(contactId: string): Promise<void> {
    await this.client.delete(`/contacts/${contactId}`);
  }

  async sync(params: ContactCreateParams): Promise<{ contact: Contact }> {
    return this.client.post<{ contact: Contact }>('/contact/sync', { contact: params });
  }

  async listAutomations(contactId: string): Promise<unknown> {
    return this.client.get<unknown>(`/contacts/${contactId}/contactAutomations`);
  }

  async listTags(contactId: string): Promise<unknown> {
    return this.client.get<unknown>(`/contacts/${contactId}/contactTags`);
  }

  async listDeals(contactId: string): Promise<unknown> {
    return this.client.get<unknown>(`/contacts/${contactId}/deals`);
  }

  async addTag(contactId: string, tagId: string): Promise<unknown> {
    return this.client.post<unknown>('/contactTags', { contactTag: { contact: contactId, tag: tagId } });
  }

  async removeTag(contactTagId: string): Promise<void> {
    await this.client.delete(`/contactTags/${contactTagId}`);
  }

  async addToList(contactId: string, listId: string, status: number = 1): Promise<unknown> {
    return this.client.post<unknown>('/contactLists', {
      contactList: { list: listId, contact: contactId, status },
    });
  }
}
