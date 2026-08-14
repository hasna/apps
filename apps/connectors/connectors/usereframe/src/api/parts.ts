import type { UsereframeClient } from './client';
import type { QueryParams } from '../types';

export class PartsApi {
  constructor(private readonly client: UsereframeClient) {}

  search(params?: QueryParams): Promise<unknown> {
    return this.client.get('/parts/search', params);
  }
}
