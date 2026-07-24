import type { ConnectorClient } from './client';
import type { SearchParams, SearchResult } from '../types';

export class SearchApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Search spreadsheet data
   * POST /search
   */
  async search(params: SearchParams): Promise<SearchResult> {
    return this.client.post<SearchResult>('/search', params);
  }
}
