import type { ConnectorClient } from './client';
import type { SearchParams } from '../types';

export class SearchApi {
  constructor(private readonly client: ConnectorClient) {}

  async search(params: SearchParams = {}): Promise<unknown> {
    return this.client.post('/search', params);
  }
}
