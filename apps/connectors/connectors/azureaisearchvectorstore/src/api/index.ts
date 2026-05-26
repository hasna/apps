// Azure AI Search Vector Store Connector — Vector search and indexing for AI
import { AzureAISearchClient } from './client';
import type { AzureAISearchConfig, AZSIndex, AZSSearchResult, AZSIndexResult, AZSVectorQuery } from '../types';
export { AzureAISearchClient } from './client';

export class AzureAISearch {
  private readonly client: AzureAISearchClient;
  constructor(config: AzureAISearchConfig) { this.client = new AzureAISearchClient(config); }
  static fromEnv(): AzureAISearch {
    const serviceName = process.env.AZURE_SEARCH_SERVICE;
    const apiKey = process.env.AZURE_SEARCH_API_KEY;
    if (!serviceName || !apiKey) throw new Error('AZURE_SEARCH_SERVICE and AZURE_SEARCH_API_KEY are required');
    return new AzureAISearch({ serviceName, apiKey, apiVersion: process.env.AZURE_SEARCH_API_VERSION });
  }

  async listIndexes(): Promise<{ value: AZSIndex[] }> { return this.client.request('/indexes'); }
  async getIndex(indexName: string): Promise<AZSIndex> { return this.client.request<AZSIndex>(`/indexes/${indexName}`); }
  async createIndex(index: { name: string; fields: { name: string; type: string; key?: boolean; searchable?: boolean; filterable?: boolean; dimensions?: number; vectorSearchProfile?: string }[] }): Promise<AZSIndex> {
    return this.client.request<AZSIndex>('/indexes', { method: 'POST', body: index as Record<string, unknown> });
  }
  async deleteIndex(indexName: string): Promise<void> { await this.client.request(`/indexes/${indexName}`, { method: 'DELETE' }); }

  async search(indexName: string, query: { search?: string; filter?: string; select?: string; top?: number; skip?: number; orderby?: string; vectorQueries?: AZSVectorQuery[] }): Promise<AZSSearchResult> {
    return this.client.request<AZSSearchResult>(`/indexes/${indexName}/docs/search`, { method: 'POST', body: query as Record<string, unknown> });
  }

  async getDocument(indexName: string, key: string, options?: { select?: string }): Promise<Record<string, unknown>> {
    return this.client.request(`/indexes/${indexName}/docs/${key}`, { params: { $select: options?.select } });
  }

  async indexDocuments(indexName: string, actions: { '@search.action': 'upload' | 'merge' | 'mergeOrUpload' | 'delete'; [key: string]: unknown }[]): Promise<AZSIndexResult> {
    return this.client.request<AZSIndexResult>(`/indexes/${indexName}/docs/index`, { method: 'POST', body: { value: actions } as Record<string, unknown> });
  }

  async countDocuments(indexName: string): Promise<number> {
    const result = await this.client.request<number>(`/indexes/${indexName}/docs/$count`);
    return result;
  }

  getClient(): AzureAISearchClient { return this.client; }
}
