import type { TransformClient } from './client';
import type { SearchParams, SearchResponse } from '../types';

export class SearchApi {
  constructor(private readonly client: TransformClient) {}

  search(body: SearchParams): Promise<SearchResponse> {
    return this.client.post<SearchResponse>('/search', body);
  }
}
