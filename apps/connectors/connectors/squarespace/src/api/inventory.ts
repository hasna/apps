import type { SquarespaceClient } from './client';
import type { InventoryAdjustmentRequest, InventoryItem } from '../types';

export interface ListInventoryOptions {
  cursor?: string;
}

export interface InventoryListResponse {
  inventory: InventoryItem[];
  pagination?: { nextPageCursor?: string; hasNextPage?: boolean };
}

export class InventoryApi {
  constructor(private readonly client: SquarespaceClient) {}

  async list(options: ListInventoryOptions = {}): Promise<InventoryListResponse> {
    return this.client.request<InventoryListResponse>('/commerce/inventory', {
      params: { cursor: options.cursor },
    });
  }

  async get(variantIds: string[]): Promise<{ inventory: InventoryItem[] }> {
    const ids = variantIds.map(encodeURIComponent).join(',');
    return this.client.request<{ inventory: InventoryItem[] }>(`/commerce/inventory/${ids}`);
  }

  async adjust(adjustment: InventoryAdjustmentRequest): Promise<unknown> {
    return this.client.request('/commerce/inventory/adjustments', {
      method: 'POST',
      body: adjustment,
    });
  }
}
