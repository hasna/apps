// Chroma Vector Store Connector — Open-source vector database for AI embeddings
import { ChromaClient } from './client';
import type { ChromaConfig, ChromaCollection, ChromaGetResult, ChromaQueryResult } from '../types';
export { ChromaClient } from './client';

export class ChromaVectorStore {
  private readonly client: ChromaClient;
  constructor(config: ChromaConfig) { this.client = new ChromaClient(config); }
  static fromEnv(): ChromaVectorStore {
    const url = process.env.CHROMA_URL;
    if (!url) throw new Error('CHROMA_URL is required');
    return new ChromaVectorStore({ url, token: process.env.CHROMA_TOKEN, tenant: process.env.CHROMA_TENANT, database: process.env.CHROMA_DATABASE });
  }

  async listCollections(options?: { limit?: number; offset?: number }): Promise<ChromaCollection[]> {
    return this.client.request<ChromaCollection[]>(`/databases/${this.client.getDatabase()}/collections`, { params: { tenant: this.client.getTenant(), limit: options?.limit, offset: options?.offset } });
  }
  async getCollection(name: string): Promise<ChromaCollection> {
    return this.client.request<ChromaCollection>(`/databases/${this.client.getDatabase()}/collections/${name}`, { params: { tenant: this.client.getTenant() } });
  }
  async createCollection(name: string, metadata?: Record<string, unknown>): Promise<ChromaCollection> {
    return this.client.request<ChromaCollection>(`/databases/${this.client.getDatabase()}/collections`, { method: 'POST', params: { tenant: this.client.getTenant() }, body: { name, metadata } });
  }
  async deleteCollection(name: string): Promise<void> {
    await this.client.request(`/databases/${this.client.getDatabase()}/collections/${name}`, { method: 'DELETE', params: { tenant: this.client.getTenant() } });
  }

  async add(collectionId: string, data: { ids: string[]; embeddings?: number[][]; documents?: string[]; metadatas?: Record<string, unknown>[] }): Promise<void> {
    await this.client.request(`/collections/${collectionId}/add`, { method: 'POST', body: data as Record<string, unknown> });
  }
  async query(collectionId: string, data: { query_embeddings?: number[][]; n_results?: number; where?: Record<string, unknown>; include?: string[] }): Promise<ChromaQueryResult> {
    return this.client.request<ChromaQueryResult>(`/collections/${collectionId}/query`, { method: 'POST', body: data as Record<string, unknown> });
  }
  async get(collectionId: string, options?: { ids?: string[]; where?: Record<string, unknown>; limit?: number; include?: string[] }): Promise<ChromaGetResult> {
    return this.client.request<ChromaGetResult>(`/collections/${collectionId}/get`, { method: 'POST', body: options as Record<string, unknown> });
  }
  async update(collectionId: string, data: { ids: string[]; embeddings?: number[][]; documents?: string[]; metadatas?: Record<string, unknown>[] }): Promise<void> {
    await this.client.request(`/collections/${collectionId}/update`, { method: 'POST', body: data as Record<string, unknown> });
  }
  async deleteDocuments(collectionId: string, ids: string[]): Promise<void> {
    await this.client.request(`/collections/${collectionId}/delete`, { method: 'POST', body: { ids } });
  }
  async count(collectionId: string): Promise<number> { return this.client.request<number>(`/collections/${collectionId}/count`); }

  async heartbeat(): Promise<{ nanosecond_heartbeat: number }> { return this.client.request('/heartbeat'); }

  getClient(): ChromaClient { return this.client; }
}
