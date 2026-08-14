import type { SseTriggerClient } from './client';
import type { JsonRecord, SearchRequest, SearchResponse } from '../types';

export class SearchApi {
  constructor(private readonly client: SseTriggerClient) {}

  async search(body: SearchRequest): Promise<SearchResponse | JsonRecord> {
    return this.client.post<SearchResponse | JsonRecord>('/search', body);
  }
}
