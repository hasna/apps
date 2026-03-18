// Grist Connector — Relational spreadsheet and database
import { GristClient } from './client';
import type { GristConfig, GROrg, GRWorkspace, GRDocument, GRTable, GRColumn, GRRecord, GRRecordList } from '../types';
export { GristClient } from './client';

export class Grist {
  private readonly client: GristClient;
  constructor(config: GristConfig) { this.client = new GristClient(config); }
  static fromEnv(): Grist {
    const apiKey = process.env.GRIST_API_KEY;
    if (!apiKey) throw new Error('GRIST_API_KEY is required');
    return new Grist({ apiKey, serverUrl: process.env.GRIST_SERVER_URL });
  }

  async listOrgs(): Promise<GROrg[]> { return this.client.request<GROrg[]>('/orgs'); }
  async listWorkspaces(orgId: number): Promise<GRWorkspace[]> { return this.client.request<GRWorkspace[]>(`/orgs/${orgId}/workspaces`); }

  async listTables(docId: string): Promise<{ tables: GRTable[] }> { return this.client.request(`/docs/${docId}/tables`); }
  async listColumns(docId: string, tableId: string): Promise<{ columns: GRColumn[] }> { return this.client.request(`/docs/${docId}/tables/${tableId}/columns`); }

  async listRecords(docId: string, tableId: string, options?: { limit?: number; sort?: string; filter?: string }): Promise<GRRecordList> {
    return this.client.request<GRRecordList>(`/docs/${docId}/tables/${tableId}/records`, { params: { limit: options?.limit, sort: options?.sort, filter: options?.filter } });
  }
  async addRecords(docId: string, tableId: string, records: { fields: Record<string, unknown> }[]): Promise<{ records: { id: number }[] }> {
    return this.client.request(`/docs/${docId}/tables/${tableId}/records`, { method: 'POST', body: { records } as unknown as Record<string, unknown> });
  }
  async updateRecords(docId: string, tableId: string, records: { id: number; fields: Record<string, unknown> }[]): Promise<void> {
    await this.client.request(`/docs/${docId}/tables/${tableId}/records`, { method: 'PATCH', body: { records } as unknown as Record<string, unknown> });
  }
  async deleteRecords(docId: string, tableId: string, recordIds: number[]): Promise<void> {
    await this.client.request(`/docs/${docId}/tables/${tableId}/data/delete`, { method: 'POST', body: recordIds as unknown as Record<string, unknown> });
  }

  getClient(): GristClient { return this.client; }
}
