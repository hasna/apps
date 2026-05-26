// CloudBoost Connector — Backend-as-a-service with database, search, and storage
import { CloudBoostClient } from './client';
import type { CloudBoostConfig, CBDocument, CBSearchResult, CBUser } from '../types';
export { CloudBoostClient } from './client';

export class CloudBoost {
  private readonly client: CloudBoostClient;
  constructor(config: CloudBoostConfig) { this.client = new CloudBoostClient(config); }
  static fromEnv(): CloudBoost {
    const appId = process.env.CLOUDBOOST_APP_ID;
    const masterKey = process.env.CLOUDBOOST_MASTER_KEY;
    if (!appId || !masterKey) throw new Error('CLOUDBOOST_APP_ID and CLOUDBOOST_MASTER_KEY are required');
    return new CloudBoost({ appId, masterKey });
  }

  async save(tableName: string, document: Record<string, unknown>): Promise<CBDocument> {
    return this.client.request<CBDocument>(`/${tableName}`, { method: 'PUT', body: { document: { _tableName: tableName, ...document } } });
  }
  async findById(tableName: string, id: string): Promise<CBDocument> {
    return this.client.request<CBDocument>(`/${tableName}/find`, { method: 'POST', body: { query: { _id: id }, limit: 1 } });
  }
  async find(tableName: string, query: Record<string, unknown>, options?: { limit?: number; skip?: number; sort?: Record<string, number> }): Promise<CBDocument[]> {
    return this.client.request<CBDocument[]>(`/${tableName}/find`, { method: 'POST', body: { query, limit: options?.limit, skip: options?.skip, sort: options?.sort } as Record<string, unknown> });
  }
  async deleteDocument(tableName: string, id: string): Promise<void> {
    await this.client.request(`/${tableName}/${id}`, { method: 'DELETE', body: { document: { _id: id, _tableName: tableName } } });
  }
  async count(tableName: string, query?: Record<string, unknown>): Promise<number> {
    return this.client.request<number>(`/${tableName}/count`, { method: 'POST', body: { query: query || {} } });
  }

  async search(tableName: string, searchQuery: string, options?: { limit?: number }): Promise<CBSearchResult> {
    return this.client.request<CBSearchResult>(`/${tableName}/search`, { method: 'POST', body: { query: searchQuery, limit: options?.limit } as Record<string, unknown> });
  }

  async signUp(username: string, email: string, password: string): Promise<CBUser> {
    return this.client.request<CBUser>('/user/signup', { method: 'POST', body: { document: { _tableName: 'User', username, email, password } } });
  }
  async login(username: string, password: string): Promise<CBUser> {
    return this.client.request<CBUser>('/user/login', { method: 'POST', body: { document: { _tableName: 'User', username, password } } });
  }

  getClient(): CloudBoostClient { return this.client; }
}
