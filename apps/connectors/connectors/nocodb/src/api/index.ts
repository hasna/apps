// NocoDB Connector — Open-source Airtable alternative and spreadsheet-database
import { NocoDBClient } from './client';
import type { NocoDBConfig, NocBase, NocTable, NocColumn, NocRecord, NocRecordList, NocView } from '../types';
export { NocoDBClient } from './client';

export class NocoDB {
  private readonly client: NocoDBClient;
  constructor(config: NocoDBConfig) { this.client = new NocoDBClient(config); }
  static fromEnv(): NocoDB {
    const token = process.env.NOCODB_TOKEN;
    if (!token) throw new Error('NOCODB_TOKEN is required');
    return new NocoDB({ token, baseUrl: process.env.NOCODB_BASE_URL });
  }

  async listBases(): Promise<{ list: NocBase[] }> { return this.client.request('/db/meta/bases'); }
  async getBase(baseId: string): Promise<NocBase> { return this.client.request(`/db/meta/bases/${baseId}`); }

  async listTables(baseId: string): Promise<{ list: NocTable[] }> { return this.client.request(`/db/meta/projects/${baseId}/tables`); }
  async getTable(tableId: string): Promise<NocTable> { return this.client.request(`/db/meta/tables/${tableId}`); }
  async createTable(baseId: string, data: { title: string; columns?: { title: string; uidt: string }[] }): Promise<NocTable> {
    return this.client.request(`/db/meta/projects/${baseId}/tables`, { method: 'POST', body: data as Record<string, unknown> });
  }
  async deleteTable(tableId: string): Promise<void> { await this.client.request(`/db/meta/tables/${tableId}`, { method: 'DELETE' }); }

  async listRecords(tableId: string, options?: { offset?: number; limit?: number; where?: string; sort?: string; fields?: string }): Promise<NocRecordList> {
    return this.client.request(`/db/data/noco/p/default/${tableId}`, { params: { offset: options?.offset, limit: options?.limit, where: options?.where, sort: options?.sort, fields: options?.fields } });
  }
  async getRecord(tableId: string, recordId: number): Promise<NocRecord> {
    return this.client.request(`/db/data/noco/p/default/${tableId}/${recordId}`);
  }
  async createRecord(tableId: string, data: Record<string, unknown>): Promise<NocRecord> {
    return this.client.request(`/db/data/noco/p/default/${tableId}`, { method: 'POST', body: data });
  }
  async updateRecord(tableId: string, recordId: number, data: Record<string, unknown>): Promise<NocRecord> {
    return this.client.request(`/db/data/noco/p/default/${tableId}/${recordId}`, { method: 'PATCH', body: data });
  }
  async deleteRecord(tableId: string, recordId: number): Promise<void> {
    await this.client.request(`/db/data/noco/p/default/${tableId}/${recordId}`, { method: 'DELETE' });
  }

  async listViews(tableId: string): Promise<{ list: NocView[] }> { return this.client.request(`/db/meta/tables/${tableId}/views`); }

  async listColumns(tableId: string): Promise<{ list: NocColumn[] }> { return this.client.request(`/db/meta/tables/${tableId}/columns`); }
  async createColumn(tableId: string, data: { title: string; uidt: string }): Promise<NocColumn> {
    return this.client.request(`/db/meta/tables/${tableId}/columns`, { method: 'POST', body: data as Record<string, unknown> });
  }

  getClient(): NocoDBClient { return this.client; }
}
