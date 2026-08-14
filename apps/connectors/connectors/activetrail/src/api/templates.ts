import type { ConnectorClient } from './client';
import type { Template, TemplateCreateParams, TemplateUpdateParams, ListParams } from '../types';

export class TemplatesApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<Template[]> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.Page !== undefined) queryParams.Page = params.Page;
    if (params?.Limit) queryParams.Limit = params.Limit;
    return this.client.get<Template[]>('/templates', queryParams);
  }

  async get(templateId: number): Promise<Template> {
    return this.client.get<Template>(`/templates/${templateId}`);
  }

  async create(params: TemplateCreateParams): Promise<Template> {
    return this.client.post<Template>('/templates', params);
  }

  async update(templateId: number, params: TemplateUpdateParams): Promise<void> {
    await this.client.put(`/templates/${templateId}`, params);
  }

  async delete(templateId: number): Promise<void> {
    await this.client.delete(`/templates/${templateId}`);
  }

  async createCampaignFromTemplate(templateId: number): Promise<unknown> {
    return this.client.post<unknown>(`/templates/${templateId}/campaign`);
  }
}
