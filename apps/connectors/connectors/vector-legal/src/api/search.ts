import type { ConnectorClient } from './client';
import type { SearchParams, SearchResponse } from '../types';

export class SearchApi {
  constructor(private readonly client: ConnectorClient) {}

  async search(params: SearchParams): Promise<SearchResponse> {
    return this.client.post<SearchResponse>('/search', params);
  }
}
