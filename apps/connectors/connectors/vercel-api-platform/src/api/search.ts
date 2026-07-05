import type { ConnectorClient } from './client';
import type { SearchRequest, SearchResponse } from '../types';

export class SearchApi {
  constructor(private readonly client: ConnectorClient) {}

  async search(body: SearchRequest): Promise<SearchResponse> {
    return this.client.post<SearchResponse>('/search', body);
  }
}
