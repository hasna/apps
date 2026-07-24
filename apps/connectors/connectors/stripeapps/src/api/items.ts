import type { StripeAppsClient } from './client';
import type { Item, ItemCreateInput, ItemListParams, ItemListResponse } from '../types';

/**
 * Items API - list, create, and fetch items.
 */
export class ItemsApi {
  constructor(private readonly client: StripeAppsClient) {}

  /** List items (GET /items). */
  list(params: ItemListParams = {}): Promise<ItemListResponse> {
    return this.client.get<ItemListResponse>('/items', {
      limit: params.limit,
      cursor: params.cursor,
      status: params.status,
    });
  }

  /** Create an item (POST /items). */
  create(input: ItemCreateInput): Promise<Item> {
    return this.client.post<Item>('/items', input);
  }

  /** Fetch a single item by id (GET /items/{itemId}). */
  get(itemId: string): Promise<Item> {
    if (!itemId) {
      throw new Error('itemId is required');
    }
    return this.client.get<Item>(`/items/${encodeURIComponent(itemId)}`);
  }
}
