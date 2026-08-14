// TrackVia Connector — Low-code workflow and database platform
import { TrackViaClient } from './client';
import type { TrackViaConfig, TVApp, TVTable, TVRecord, TVRecordList, TVView, TVUser } from '../types';
export { TrackViaClient } from './client';

export class TrackVia {
  private readonly client: TrackViaClient;
  constructor(config: TrackViaConfig) { this.client = new TrackViaClient(config); }
  static fromEnv(): TrackVia {
    const token = process.env.TRACKVIA_TOKEN;
    const accountId = process.env.TRACKVIA_ACCOUNT_ID;
    if (!token || !accountId) throw new Error('TRACKVIA_TOKEN and TRACKVIA_ACCOUNT_ID are required');
    return new TrackVia({ token, accountId });
  }

  async listApps(): Promise<TVApp[]> { return this.client.request<TVApp[]>('/apps'); }
  async getApp(appId: number): Promise<TVApp> { return this.client.request<TVApp>(`/apps/${appId}`); }

  async listViews(options?: { name?: string }): Promise<TVView[]> {
    return this.client.request<TVView[]>('/views', { params: { name: options?.name } });
  }
  async getView(viewId: number): Promise<TVView> { return this.client.request<TVView>(`/views/${viewId}`); }

  async listRecords(viewId: number, options?: { start?: number; max?: number; q?: string }): Promise<TVRecordList> {
    return this.client.request<TVRecordList>(`/views/${viewId}/find`, { params: { start: options?.start, max: options?.max, q: options?.q } });
  }
  async getRecord(viewId: number, recordId: number): Promise<TVRecord> {
    return this.client.request<TVRecord>(`/views/${viewId}/records/${recordId}`);
  }
  async createRecord(viewId: number, data: Record<string, unknown>): Promise<TVRecord> {
    return this.client.request<TVRecord>(`/views/${viewId}/records`, { method: 'POST', body: { data } });
  }
  async updateRecord(viewId: number, recordId: number, data: Record<string, unknown>): Promise<TVRecord> {
    return this.client.request<TVRecord>(`/views/${viewId}/records/${recordId}`, { method: 'PUT', body: { data } });
  }
  async deleteRecord(viewId: number, recordId: number): Promise<void> {
    await this.client.request(`/views/${viewId}/records/${recordId}`, { method: 'DELETE' });
  }

  async listUsers(): Promise<TVUser[]> { return this.client.request<TVUser[]>('/users'); }

  getClient(): TrackViaClient { return this.client; }
}
