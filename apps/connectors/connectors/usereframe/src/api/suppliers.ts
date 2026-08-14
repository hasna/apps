import type { UsereframeClient } from './client';
import type { QueryParams } from '../types';

export class SuppliersApi {
  constructor(private readonly client: UsereframeClient) {}

  list(params?: QueryParams): Promise<unknown> {
    return this.client.get('/suppliers', params);
  }
}
