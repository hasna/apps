import type { SearchRequest, SearchResponse } from '../types';
import type { WeightsBiasesApiPlatformClient } from './client';

export class SearchApi {
  constructor(private readonly client: WeightsBiasesApiPlatformClient) {}

  search(body: SearchRequest): Promise<SearchResponse> {
    return this.client.post<SearchResponse>('/search', body);
  }
}
