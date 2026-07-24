import type { ConnectorClient } from './client';
import type { ListParams, SearchRequest, SearchResponse } from '../types';

export class SearchApi {
  constructor(private readonly client: ConnectorClient) {}

  async search(body: SearchRequest, params?: ListParams): Promise<SearchResponse> {
    return this.client.post<SearchResponse>('/search', body, params);
  }
}
