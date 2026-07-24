import type { ConnectorClient } from './client';
import type { ItemResponse, ItemsListResponse, ListParams } from '../types';

export class ItemsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<ItemsListResponse> {
    return this.client.get<ItemsListResponse>('/items', params);
  }

  async get(itemId: string, params?: ListParams): Promise<ItemResponse> {
    const encoded = encodeURIComponent(itemId);
    return this.client.get<ItemResponse>(`/items/${encoded}`, params);
  }

  async create(body: Record<string, unknown>, params?: ListParams): Promise<ItemResponse> {
    return this.client.post<ItemResponse>('/items', body, params);
  }
}
