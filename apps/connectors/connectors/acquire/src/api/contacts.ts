import type { ConnectorClient } from './client';
import type { Contact, ContactCreateParams, ContactUpdateParams, ContactSearchParams, ContactBlockParams, ListParams } from '../types';

export class ContactsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<unknown> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.limit) queryParams.limit = params.limit;
    if (params?.where) queryParams.where = params.where;
    if (params?.relations) queryParams.relations = params.relations;
    if (params?.select) queryParams.select = params.select;
    return this.client.get<unknown>('/crm/objects/contact', queryParams);
  }

  async get(contactId: number, params?: { relations?: string }): Promise<Contact> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.relations) queryParams.relations = params.relations;
    return this.client.get<Contact>(`/crm/objects/contact/${contactId}`, queryParams);
  }

  async create(params: ContactCreateParams): Promise<Contact> {
    return this.client.post<Contact>('/crm/objects/contact', params);
  }

  async update(contactId: number, params: ContactUpdateParams): Promise<Contact> {
    return this.client.put<Contact>(`/crm/objects/contact/${contactId}`, params);
  }

  async delete(contactId: number): Promise<void> {
    await this.client.delete(`/crm/objects/contact/${contactId}`);
  }

  async search(params: ContactSearchParams): Promise<unknown> {
    return this.client.post<unknown>('/crm/contact/list', params);
  }

  async block(params: ContactBlockParams): Promise<unknown> {
    return this.client.post<unknown>('/crm/block-visitor', params);
  }

  async merge(primaryContactId: number, sourceIds: number[]): Promise<unknown> {
    return this.client.post<unknown>(`/crm/contact/merge/${primaryContactId}`, { sourceIds });
  }
}
