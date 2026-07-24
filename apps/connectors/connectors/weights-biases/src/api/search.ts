import type { SearchRequest, SearchResponse } from '../types';
import type { WeightsBiasesClient } from './client';

export class SearchApi {
  constructor(private readonly client: WeightsBiasesClient) {}

  search(body: SearchRequest): Promise<SearchResponse> {
    return this.client.post<SearchResponse>('/search', body);
  }
}
