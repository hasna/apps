import type { TrueLayerSearchRequest } from '../types';
import type { TrueLayerClient } from './client';

export class SearchApi {
  constructor(private readonly client: TrueLayerClient) {}

  async search(
    data: TrueLayerSearchRequest,
    headers?: Record<string, string>,
  ): Promise<unknown> {
    return this.client.request('/search', {
      method: 'POST',
      body: data,
      headers,
    });
  }
}
