import type { JsonRecord, ListQueryParams } from '../types';
import type { ConnectorClient } from './client';

export class ItemsApi {
  constructor(private readonly client: ConnectorClient) {}

  list(params?: ListQueryParams): Promise<unknown> {
    return this.client.get('/items', params);
  }

  create(body: JsonRecord): Promise<unknown> {
    return this.client.post('/items', body);
  }

  get(itemId: string, params?: ListQueryParams): Promise<unknown> {
    const encodedId = encodeURIComponent(itemId);
    return this.client.get(`/items/${encodedId}`, params);
  }
}
