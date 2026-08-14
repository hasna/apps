import type { ConnectorClient } from './client';
import type { SearchParams, SearchResult } from '../types';

export class SearchApi {
  constructor(private readonly client: ConnectorClient) {}

  /** POST /search */
  async search(body: SearchParams): Promise<SearchResult | Record<string, unknown>> {
    return this.client.post('/search', body);
  }
}
