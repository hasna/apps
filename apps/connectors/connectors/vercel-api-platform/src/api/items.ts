import type { ConnectorClient } from './client';
import type { ItemsListResponse, ListParams, PlatformItem } from '../types';
import { encodePathSegment } from '../types';

export class ItemsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<ItemsListResponse> {
    return this.client.get<ItemsListResponse>('/items', params);
  }

  async create(body: Record<string, unknown>): Promise<PlatformItem> {
    return this.client.post<PlatformItem>('/items', body);
  }

  async get(itemId: string): Promise<PlatformItem> {
    return this.client.get<PlatformItem>(`/items/${encodePathSegment(itemId)}`);
  }
}
