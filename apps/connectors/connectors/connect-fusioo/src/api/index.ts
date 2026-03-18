// Fusioo Connector
// Custom business apps and database management platform

import { FusiooClient } from './client';
import type { FusiooConfig, App, AppRecord, User } from '../types';

export { FusiooClient } from './client';

export class Fusioo {
  private readonly client: FusiooClient;

  constructor(config: FusiooConfig) {
    this.client = new FusiooClient(config);
  }

  static fromEnv(): Fusioo {
    const apiKey = process.env.FUSIOO_API_KEY;
    const workspaceId = process.env.FUSIOO_WORKSPACE_ID;
    if (!apiKey) throw new Error('FUSIOO_API_KEY environment variable is required');
    if (!workspaceId) throw new Error('FUSIOO_WORKSPACE_ID environment variable is required');
    return new Fusioo({ apiKey, workspaceId });
  }

  // Apps (databases)
  async listApps(): Promise<App[]> {
    const result = await this.client.request<{ apps: App[] }>('/apps');
    return result.apps ?? [];
  }

  async getApp(appId: string): Promise<App> {
    return this.client.request<App>(`/apps/${appId}`);
  }

  // Records
  async listRecords(appId: string, options?: {
    page?: number;
    perPage?: number;
    search?: string;
    sortField?: string;
    sortOrder?: 'asc' | 'desc';
  }): Promise<{ records: AppRecord[]; total: number; page: number }> {
    return this.client.request(`/apps/${appId}/records`, { params: options as Record<string, string | number | undefined> });
  }

  async getRecord(appId: string, recordId: string): Promise<AppRecord> {
    return this.client.request<AppRecord>(`/apps/${appId}/records/${recordId}`);
  }

  async createRecord(appId: string, fields: Record<string, unknown>): Promise<AppRecord> {
    return this.client.request<AppRecord>(`/apps/${appId}/records`, {
      method: 'POST',
      body: { fields },
    });
  }

  async updateRecord(appId: string, recordId: string, fields: Record<string, unknown>): Promise<AppRecord> {
    return this.client.request<AppRecord>(`/apps/${appId}/records/${recordId}`, {
      method: 'PUT',
      body: { fields },
    });
  }

  async deleteRecord(appId: string, recordId: string): Promise<void> {
    await this.client.request(`/apps/${appId}/records/${recordId}`, { method: 'DELETE' });
  }

  // Users
  async listUsers(): Promise<User[]> {
    const result = await this.client.request<{ users: User[] }>('/users');
    return result.users ?? [];
  }

  async getUser(userId: string): Promise<User> {
    return this.client.request<User>(`/users/${userId}`);
  }

  getClient(): FusiooClient { return this.client; }
}
