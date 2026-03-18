// Kibana Connector — Data visualization and exploration for Elasticsearch
import { KibanaClient } from './client';
import type { KibanaConfig, KBSavedObject, KBSavedObjectList, KBSpace, KBStatus } from '../types';
export { KibanaClient } from './client';

export class Kibana {
  private readonly client: KibanaClient;
  constructor(config: KibanaConfig) { this.client = new KibanaClient(config); }
  static fromEnv(): Kibana {
    const url = process.env.KIBANA_URL;
    if (!url) throw new Error('KIBANA_URL is required');
    return new Kibana({ url, apiKey: process.env.KIBANA_API_KEY, username: process.env.KIBANA_USERNAME, password: process.env.KIBANA_PASSWORD });
  }

  async getStatus(): Promise<KBStatus> { return this.client.request<KBStatus>('/status'); }

  async listSavedObjects(type: string, options?: { page?: number; per_page?: number; search?: string }): Promise<KBSavedObjectList> {
    return this.client.request<KBSavedObjectList>('/saved_objects/_find', { params: { type, page: options?.page, per_page: options?.per_page, search: options?.search } });
  }
  async getSavedObject(type: string, id: string): Promise<KBSavedObject> {
    return this.client.request<KBSavedObject>(`/saved_objects/${type}/${id}`);
  }
  async createSavedObject(type: string, attributes: Record<string, unknown>, id?: string): Promise<KBSavedObject> {
    const path = id ? `/saved_objects/${type}/${id}` : `/saved_objects/${type}`;
    return this.client.request<KBSavedObject>(path, { method: 'POST', body: { attributes } });
  }
  async updateSavedObject(type: string, id: string, attributes: Record<string, unknown>): Promise<KBSavedObject> {
    return this.client.request<KBSavedObject>(`/saved_objects/${type}/${id}`, { method: 'PUT', body: { attributes } });
  }
  async deleteSavedObject(type: string, id: string): Promise<void> {
    await this.client.request(`/saved_objects/${type}/${id}`, { method: 'DELETE' });
  }

  async listSpaces(): Promise<KBSpace[]> { return this.client.request<KBSpace[]>('/spaces/space'); }
  async getSpace(spaceId: string): Promise<KBSpace> { return this.client.request<KBSpace>(`/spaces/space/${spaceId}`); }

  async listDashboards(options?: { page?: number; per_page?: number }): Promise<KBSavedObjectList> {
    return this.listSavedObjects('dashboard', options);
  }
  async listIndexPatterns(options?: { page?: number; per_page?: number }): Promise<KBSavedObjectList> {
    return this.listSavedObjects('index-pattern', options);
  }

  getClient(): KibanaClient { return this.client; }
}
