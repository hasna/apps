// Elasticsearch Connector — Distributed search and analytics engine
import { ElasticsearchClient } from './client';
import type { ElasticsearchConfig, ESSearchResult, ESIndex, ESIndexMapping, ESBulkResult, ESClusterHealth } from '../types';
export { ElasticsearchClient } from './client';

export class Elasticsearch {
  private readonly client: ElasticsearchClient;
  constructor(config: ElasticsearchConfig) { this.client = new ElasticsearchClient(config); }
  static fromEnv(): Elasticsearch {
    const url = process.env.ELASTICSEARCH_URL;
    if (!url) throw new Error('ELASTICSEARCH_URL is required');
    return new Elasticsearch({ url, apiKey: process.env.ELASTICSEARCH_API_KEY, username: process.env.ELASTICSEARCH_USERNAME, password: process.env.ELASTICSEARCH_PASSWORD });
  }

  async search(index: string, query: { query?: Record<string, unknown>; size?: number; from?: number; sort?: unknown[]; _source?: string[] | boolean; aggs?: Record<string, unknown>; highlight?: Record<string, unknown> }): Promise<ESSearchResult> {
    return this.client.request<ESSearchResult>(`/${index}/_search`, { method: 'POST', body: query as Record<string, unknown> });
  }

  async getDocument(index: string, id: string): Promise<{ _index: string; _id: string; _source: Record<string, unknown> }> {
    return this.client.request(`/${index}/_doc/${id}`);
  }
  async indexDocument(index: string, doc: Record<string, unknown>, id?: string): Promise<{ _id: string; result: string }> {
    const path = id ? `/${index}/_doc/${id}` : `/${index}/_doc`;
    return this.client.request(path, { method: id ? 'PUT' : 'POST', body: doc });
  }
  async updateDocument(index: string, id: string, doc: Record<string, unknown>): Promise<{ _id: string; result: string }> {
    return this.client.request(`/${index}/_update/${id}`, { method: 'POST', body: { doc } });
  }
  async deleteDocument(index: string, id: string): Promise<{ result: string }> {
    return this.client.request(`/${index}/_doc/${id}`, { method: 'DELETE' });
  }

  async bulk(operations: string): Promise<ESBulkResult> {
    return this.client.request<ESBulkResult>('/_bulk', { method: 'POST', body: operations });
  }

  async listIndices(): Promise<ESIndex[]> { return this.client.request<ESIndex[]>('/_cat/indices', { params: { format: 'json' } }); }
  async createIndex(index: string, settings?: { mappings?: Record<string, unknown>; settings?: Record<string, unknown> }): Promise<{ acknowledged: boolean }> {
    return this.client.request(`/${index}`, { method: 'PUT', body: settings as Record<string, unknown> });
  }
  async deleteIndex(index: string): Promise<{ acknowledged: boolean }> { return this.client.request(`/${index}`, { method: 'DELETE' }); }
  async getMapping(index: string): Promise<Record<string, ESIndexMapping>> { return this.client.request(`/${index}/_mapping`); }

  async clusterHealth(): Promise<ESClusterHealth> { return this.client.request<ESClusterHealth>('/_cluster/health'); }
  async count(index: string, query?: Record<string, unknown>): Promise<{ count: number }> {
    return this.client.request(`/${index}/_count`, query ? { method: 'POST', body: { query } } : {});
  }

  getClient(): ElasticsearchClient { return this.client; }
}
