import type { ConnectorClient } from './client';
import type { ContactList, ListCreateParams, ListParams } from '../types';

export class ListsApi {
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
    return this.client.get<unknown>('/lists', queryParams);
  }

  async get(listId: string): Promise<{ list: ContactList }> {
    return this.client.get<{ list: ContactList }>(`/lists/${listId}`);
  }

  async create(params: ListCreateParams): Promise<{ list: ContactList }> {
    return this.client.post<{ list: ContactList }>('/lists', { list: params });
  }

  async delete(listId: string): Promise<void> {
    await this.client.delete(`/lists/${listId}`);
  }
}
