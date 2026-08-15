// Fusioo Connector — Custom business apps and database management
import { FusiooClient } from './client';
import type { FusiooConfig, FusiooApp, FusiooRecord, FusiooRecordList, FusiooWorkspace } from '../types';
export { FusiooClient } from './client';

export class Fusioo {
  private readonly client: FusiooClient;
  constructor(config: FusiooConfig) { this.client = new FusiooClient(config); }
  static fromEnv(): Fusioo {
    const token = process.env.FUSIOO_TOKEN;
    if (!token) throw new Error('FUSIOO_TOKEN is required');
    return new Fusioo({ token });
  }

  async listWorkspaces(): Promise<FusiooWorkspace[]> { return this.client.request<FusiooWorkspace[]>('/workspaces'); }

  async listApps(): Promise<FusiooApp[]> { return this.client.request<FusiooApp[]>('/apps'); }
  async getApp(appId: string): Promise<FusiooApp> { return this.client.request<FusiooApp>(`/apps/${appId}`); }

  async listRecords(appId: string, options?: { page?: number; per_page?: number; sort?: string }): Promise<FusiooRecordList> {
    return this.client.request<FusiooRecordList>(`/apps/${appId}/records`, { params: { page: options?.page, per_page: options?.per_page, sort: options?.sort } });
  }
  async getRecord(appId: string, recordId: string): Promise<FusiooRecord> {
    return this.client.request<FusiooRecord>(`/apps/${appId}/records/${recordId}`);
  }
  async createRecord(appId: string, fields: Record<string, unknown>): Promise<FusiooRecord> {
    return this.client.request<FusiooRecord>(`/apps/${appId}/records`, { method: 'POST', body: { fields } });
  }
  async updateRecord(appId: string, recordId: string, fields: Record<string, unknown>): Promise<FusiooRecord> {
    return this.client.request<FusiooRecord>(`/apps/${appId}/records/${recordId}`, { method: 'PUT', body: { fields } });
  }
  async deleteRecord(appId: string, recordId: string): Promise<void> {
    await this.client.request(`/apps/${appId}/records/${recordId}`, { method: 'DELETE' });
  }

  getClient(): FusiooClient { return this.client; }
}
