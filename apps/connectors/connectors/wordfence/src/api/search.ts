import type { ConnectorClient } from './client';
import type { SearchParams, SearchResult } from '../types';

export class SearchApi {
  constructor(private readonly client: ConnectorClient) {}

  async search(params: SearchParams): Promise<SearchResult> {
    if (!params.query?.trim()) {
      throw new Error('Search query is required');
    }
    return this.client.post<SearchResult>('/search', params);
  }
}
