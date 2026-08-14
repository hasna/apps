// QuintaDB Connector — Online database and web form builder
import { QuintaDBClient } from './client';
import type { QuintaDBConfig, QDBEntity, QDBRecord, QDBProperty } from '../types';
export { QuintaDBClient } from './client';

export class QuintaDB {
  private readonly client: QuintaDBClient;
  constructor(config: QuintaDBConfig) { this.client = new QuintaDBClient(config); }
  static fromEnv(): QuintaDB {
    const apiKey = process.env.QUINTADB_API_KEY;
    const appId = process.env.QUINTADB_APP_ID;
    if (!apiKey || !appId) throw new Error('QUINTADB_API_KEY and QUINTADB_APP_ID are required');
    return new QuintaDB({ apiKey, appId });
  }

  async listEntities(): Promise<QDBEntity[]> { return this.client.request<QDBEntity[]>('/dtypes.json'); }
  async getEntity(entityId: string): Promise<QDBEntity> { return this.client.request<QDBEntity>(`/dtypes/${entityId}.json`); }

  async listRecords(entityId: string, options?: { page?: number; per_page?: number }): Promise<QDBRecord[]> {
    return this.client.request<QDBRecord[]>(`/dtypes/${entityId}/records.json`, { params: options as Record<string, number | undefined> });
  }
  async getRecord(entityId: string, recordId: string): Promise<QDBRecord> {
    return this.client.request<QDBRecord>(`/dtypes/${entityId}/records/${recordId}.json`);
  }
  async createRecord(entityId: string, values: Record<string, unknown>): Promise<QDBRecord> {
    return this.client.request<QDBRecord>(`/dtypes/${entityId}/records.json`, { method: 'POST', body: { values } });
  }
  async updateRecord(entityId: string, recordId: string, values: Record<string, unknown>): Promise<QDBRecord> {
    return this.client.request<QDBRecord>(`/dtypes/${entityId}/records/${recordId}.json`, { method: 'PUT', body: { values } });
  }
  async deleteRecord(entityId: string, recordId: string): Promise<void> {
    await this.client.request(`/dtypes/${entityId}/records/${recordId}.json`, { method: 'DELETE' });
  }

  async listProperties(entityId: string): Promise<QDBProperty[]> {
    return this.client.request<QDBProperty[]>(`/dtypes/${entityId}/properties.json`);
  }

  getClient(): QuintaDBClient { return this.client; }
}
