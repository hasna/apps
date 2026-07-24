import type { ConnectorClient } from './client';
import { encodePathSegment } from './client';
import type { JsonRecord, TemplateListParams } from '../types';

export class TemplatesApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: TemplateListParams): Promise<JsonRecord> {
    return this.client.get<JsonRecord>('/templates', params as Record<string, string | number | boolean | undefined>);
  }

  async get(templateId: string): Promise<JsonRecord> {
    return this.client.get<JsonRecord>(`/templates/${encodePathSegment(templateId)}`);
  }
}
