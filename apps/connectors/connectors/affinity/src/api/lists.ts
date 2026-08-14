import type { ConnectorClient } from './client';
import type { AffinityList, ListEntry, ListEntryCreateParams, Field, ListParams, PaginatedResponse } from '../types';

export class ListsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<PaginatedResponse<AffinityList>> {
    return this.client.get<PaginatedResponse<AffinityList>>('/v2/lists', params as Record<string, string | number | boolean | undefined>);
  }

  async get(id: number): Promise<AffinityList> {
    return this.client.get<AffinityList>(`/v2/lists/${id}`);
  }

  async getFields(listId: number): Promise<PaginatedResponse<Field>> {
    return this.client.get<PaginatedResponse<Field>>(`/v2/lists/${listId}/fields`);
  }

  async listEntries(listId: number, params?: ListParams): Promise<PaginatedResponse<ListEntry>> {
    return this.client.get<PaginatedResponse<ListEntry>>(`/v2/lists/${listId}/list-entries`, params as Record<string, string | number | boolean | undefined>);
  }

  async getEntry(listId: number, entryId: number): Promise<ListEntry> {
    return this.client.get<ListEntry>(`/v2/lists/${listId}/list-entries/${entryId}`);
  }

  async createEntry(listId: number, data: ListEntryCreateParams): Promise<ListEntry> {
    return this.client.post<ListEntry>(`/v2/lists/${listId}/list-entries`, data);
  }

  async deleteEntry(listId: number, entryId: number): Promise<void> {
    await this.client.delete(`/v2/lists/${listId}/list-entries/${entryId}`);
  }
}
