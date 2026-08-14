import type { ConnectorClient } from './client';
import type { CreateItemParams, ListItemsParams } from '../types';

export class ItemsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * List items
   * GET /items
   */
  async list(params?: ListItemsParams): Promise<unknown> {
    return this.client.get('/items', params);
  }

  /**
   * Create an item
   * POST /items
   */
  async create(params: CreateItemParams): Promise<unknown> {
    return this.client.post('/items', params);
  }

  /**
   * Get a single item
   * GET /items/:itemId
   */
  async get(itemId: string): Promise<unknown> {
    return this.client.get(`/items/${encodeURIComponent(itemId)}`);
  }
}
