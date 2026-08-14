// AITable.ai Connector — AI-powered spreadsheet/database platform
import { AITableClient } from './client';
import type { AITableConfig, AITSpace, AITNode, AITField, AITRecord, AITRecordList, AITView } from '../types';
export { AITableClient } from './client';

export class AITable {
  private readonly client: AITableClient;
  constructor(config: AITableConfig) { this.client = new AITableClient(config); }
  static fromEnv(): AITable {
    const token = process.env.AITABLE_TOKEN;
    if (!token) throw new Error('AITABLE_TOKEN is required');
    return new AITable({ token, baseUrl: process.env.AITABLE_BASE_URL });
  }

  async listSpaces(): Promise<AITSpace[]> { return this.client.request<AITSpace[]>('/spaces'); }
  async listNodes(spaceId: string): Promise<AITNode[]> { return this.client.request<AITNode[]>(`/spaces/${spaceId}/nodes`); }

  async listFields(datasheetId: string): Promise<AITField[]> { return this.client.request<AITField[]>(`/datasheets/${datasheetId}/fields`); }
  async createField(datasheetId: string, data: { name: string; type: string; property?: Record<string, unknown> }): Promise<AITField> {
    return this.client.request<AITField>(`/datasheets/${datasheetId}/fields`, { method: 'POST', body: data as Record<string, unknown> });
  }
  async deleteField(datasheetId: string, fieldId: string): Promise<void> {
    await this.client.request(`/datasheets/${datasheetId}/fields/${fieldId}`, { method: 'DELETE' });
  }

  async listRecords(datasheetId: string, options?: { pageNum?: number; pageSize?: number; viewId?: string; sort?: string; fieldKey?: string }): Promise<AITRecordList> {
    return this.client.request<AITRecordList>(`/datasheets/${datasheetId}/records`, { params: { pageNum: options?.pageNum, pageSize: options?.pageSize, viewId: options?.viewId, sort: options?.sort, fieldKey: options?.fieldKey } });
  }
  async createRecords(datasheetId: string, records: { fields: Record<string, unknown> }[]): Promise<AITRecord[]> {
    return this.client.request<AITRecord[]>(`/datasheets/${datasheetId}/records`, { method: 'POST', body: { records } as Record<string, unknown> });
  }
  async updateRecords(datasheetId: string, records: { recordId: string; fields: Record<string, unknown> }[]): Promise<AITRecord[]> {
    return this.client.request<AITRecord[]>(`/datasheets/${datasheetId}/records`, { method: 'PATCH', body: { records } as Record<string, unknown> });
  }
  async deleteRecords(datasheetId: string, recordIds: string[]): Promise<void> {
    const params = recordIds.map(id => `recordIds=${id}`).join('&');
    await this.client.request(`/datasheets/${datasheetId}/records?${params}`, { method: 'DELETE' });
  }

  async listViews(datasheetId: string): Promise<AITView[]> { return this.client.request<AITView[]>(`/datasheets/${datasheetId}/views`); }

  getClient(): AITableClient { return this.client; }
}
