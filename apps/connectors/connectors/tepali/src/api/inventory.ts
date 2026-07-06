import type { ConnectorClient } from './client';
import type { InventoryItem, InventoryListParams, ListResponse } from '../types';

export class InventoryApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: InventoryListParams): Promise<ListResponse<InventoryItem>> {
    return this.client.get<ListResponse<InventoryItem>>('/inventory', params as Record<string, string | number | boolean | undefined>);
  }

  async get(id: string): Promise<InventoryItem> {
    return this.client.get<InventoryItem>(`/inventory/${encodeURIComponent(id)}`);
  }
}
