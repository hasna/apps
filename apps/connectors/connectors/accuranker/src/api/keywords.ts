import type { ConnectorClient } from './client';
import type { Keyword, KeywordCreateParams, KeywordUpdateParams, KeywordDeleteParams, ListParams } from '../types';

export class KeywordsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(domainId: number, params?: ListParams & { period_from?: string; period_to?: string }): Promise<Keyword[]> {
    return this.client.get<Keyword[]>(`/domains/${domainId}/keywords/`, params as Record<string, string | number | boolean | undefined>);
  }

  async get(domainId: number, keywordId: number, params?: { fields?: string }): Promise<Keyword> {
    return this.client.get<Keyword>(`/domains/${domainId}/keywords/${keywordId}/`, params as Record<string, string | number | boolean | undefined>);
  }

  async create(params: KeywordCreateParams): Promise<unknown> {
    return this.client.post('/keyword/', params);
  }

  async update(params: KeywordUpdateParams): Promise<unknown> {
    return this.client.put('/keyword/', params);
  }

  async delete(params: KeywordDeleteParams): Promise<void> {
    await this.client.delete('/keyword/', params);
  }

  async getJobStatus(jobId: string): Promise<unknown> {
    return this.client.get(`/status/keyword_job/${jobId}`);
  }
}
