// Kibana Connector
// Elastic Stack dashboards, data views, alerting, and spaces

import { KibanaClient } from './client';
import type {
  KibanaConfig,
  KibanaStatus,
  SavedObject,
  DataView,
  AlertingRule,
  Space,
} from '../types';

export { KibanaClient } from './client';

export class Kibana {
  private readonly client: KibanaClient;

  constructor(config: KibanaConfig) {
    this.client = new KibanaClient(config);
  }

  static fromEnv(): Kibana {
    const baseUrl = process.env.KIBANA_URL || process.env.KIBANA_BASE_URL;
    const apiKey = process.env.KIBANA_API_KEY;
    const username = process.env.KIBANA_USERNAME;
    const password = process.env.KIBANA_PASSWORD;
    if (!baseUrl) throw new Error('KIBANA_URL environment variable is required');
    return new Kibana({ baseUrl, apiKey, username, password });
  }

  // ============================================
  // Status
  // ============================================

  async getStatus(): Promise<KibanaStatus> {
    return this.client.get<KibanaStatus>('/api/status');
  }

  // ============================================
  // Saved Objects (dashboards, visualizations, etc.)
  // ============================================

  async getSavedObject(type: string, id: string): Promise<SavedObject> {
    return this.client.get<SavedObject>(`/api/saved_objects/${type}/${id}`);
  }

  async findSavedObjects(type: string, options?: {
    search?: string;
    perPage?: number;
    page?: number;
    searchFields?: string[];
  }): Promise<{ page: number; per_page: number; total: number; saved_objects: SavedObject[] }> {
    return this.client.get('/api/saved_objects/_find', {
      type,
      search: options?.search,
      per_page: options?.perPage,
      page: options?.page,
      search_fields: options?.searchFields?.join(','),
    });
  }

  async createSavedObject(type: string, attributes: Record<string, unknown>, id?: string): Promise<SavedObject> {
    const path = id ? `/api/saved_objects/${type}/${id}` : `/api/saved_objects/${type}`;
    return this.client.post<SavedObject>(path, { attributes });
  }

  async updateSavedObject(type: string, id: string, attributes: Record<string, unknown>): Promise<SavedObject> {
    return this.client.put<SavedObject>(`/api/saved_objects/${type}/${id}`, { attributes });
  }

  async deleteSavedObject(type: string, id: string): Promise<void> {
    await this.client.delete(`/api/saved_objects/${type}/${id}`);
  }

  // ============================================
  // Data Views
  // ============================================

  async listDataViews(): Promise<{ data_view: DataView[] }> {
    return this.client.get('/api/data_views');
  }

  async getDataView(id: string): Promise<{ data_view: DataView }> {
    return this.client.get(`/api/data_views/data_view/${id}`);
  }

  async createDataView(dataView: {
    title: string;
    name?: string;
    timeFieldName?: string;
  }): Promise<{ data_view: DataView }> {
    return this.client.post('/api/data_views/data_view', { data_view: dataView });
  }

  async deleteDataView(id: string): Promise<void> {
    await this.client.delete(`/api/data_views/data_view/${id}`);
  }

  // ============================================
  // Alerting
  // ============================================

  async listAlertingRules(options?: {
    page?: number;
    perPage?: number;
    ruleTypeId?: string;
  }): Promise<{ page: number; per_page: number; total: number; data: AlertingRule[] }> {
    return this.client.get('/api/alerting/rules/_find', {
      page: options?.page,
      per_page: options?.perPage,
      rule_type_ids: options?.ruleTypeId,
    });
  }

  async getAlertingRule(ruleId: string): Promise<AlertingRule> {
    return this.client.get(`/api/alerting/rule/${ruleId}`);
  }

  async enableRule(ruleId: string): Promise<void> {
    await this.client.post(`/api/alerting/rule/${ruleId}/_enable`);
  }

  async disableRule(ruleId: string): Promise<void> {
    await this.client.post(`/api/alerting/rule/${ruleId}/_disable`);
  }

  async deleteRule(ruleId: string): Promise<void> {
    await this.client.delete(`/api/alerting/rule/${ruleId}`);
  }

  // ============================================
  // Spaces
  // ============================================

  async listSpaces(): Promise<Space[]> {
    return this.client.get('/api/spaces/space');
  }

  async getSpace(spaceId: string): Promise<Space> {
    return this.client.get(`/api/spaces/space/${spaceId}`);
  }

  async createSpace(space: {
    id: string;
    name: string;
    description?: string;
    color?: string;
    disabledFeatures?: string[];
  }): Promise<Space> {
    return this.client.post('/api/spaces/space', space as Record<string, unknown>);
  }

  async deleteSpace(spaceId: string): Promise<void> {
    await this.client.delete(`/api/spaces/space/${spaceId}`);
  }

  getClient(): KibanaClient {
    return this.client;
  }
}
