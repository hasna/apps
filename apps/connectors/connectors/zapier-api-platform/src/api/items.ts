import type { ConnectorClient } from './client';
import type { ItemCreateParams, ItemListParams, PlatformItem } from '../types';

export class ItemsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ItemListParams): Promise<unknown> {
    return this.client.get('/items', params as Record<string, string | number | boolean | undefined>);
  }

  async create(body: ItemCreateParams): Promise<PlatformItem> {
    return this.client.post<PlatformItem>('/items', body);
  }

  async get(itemId: string): Promise<PlatformItem> {
    return this.client.get<PlatformItem>(`/items/${encodeURIComponent(itemId)}`);
  }
}
