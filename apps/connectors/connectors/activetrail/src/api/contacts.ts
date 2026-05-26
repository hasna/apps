import type { ConnectorClient } from './client';
import type { Contact, ContactCreateParams, ContactUpdateParams, ListParams } from '../types';

export class ContactsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<Contact[]> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.Page !== undefined) queryParams.Page = params.Page;
    if (params?.Limit) queryParams.Limit = params.Limit;
    return this.client.get<Contact[]>('/contacts', queryParams);
  }

  async get(contactId: number): Promise<Contact> {
    return this.client.get<Contact>(`/contacts/${contactId}`);
  }

  async create(params: ContactCreateParams): Promise<Contact> {
    return this.client.post<Contact>('/contacts', params);
  }

  async update(contactId: number, params: ContactUpdateParams): Promise<void> {
    await this.client.put(`/contacts/${contactId}`, params);
  }

  async delete(contactId: number): Promise<void> {
    await this.client.delete(`/contacts/${contactId}`);
  }

  async import(contacts: ContactCreateParams[]): Promise<unknown> {
    return this.client.post<unknown>('/contacts/Import', contacts);
  }

  async getGroups(contactId: number): Promise<unknown> {
    return this.client.get<unknown>(`/contacts/${contactId}/groups`);
  }

  async getActivity(contactId: number): Promise<unknown> {
    return this.client.get<unknown>(`/contacts/${contactId}/activity`);
  }

  async getUnsubscribers(params?: ListParams): Promise<unknown> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.Page !== undefined) queryParams.Page = params.Page;
    if (params?.Limit) queryParams.Limit = params.Limit;
    return this.client.get<unknown>('/contacts/Subscription/Unsubscribers', queryParams);
  }

  async getSubscribers(params?: ListParams): Promise<unknown> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.Page !== undefined) queryParams.Page = params.Page;
    if (params?.Limit) queryParams.Limit = params.Limit;
    return this.client.get<unknown>('/contacts/Subscription/Subscribers', queryParams);
  }
}
