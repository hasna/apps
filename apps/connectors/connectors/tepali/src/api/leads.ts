import type { ConnectorClient } from './client';
import type { Lead, LeadListParams, ListResponse } from '../types';

export class LeadsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: LeadListParams): Promise<ListResponse<Lead>> {
    return this.client.get<ListResponse<Lead>>('/leads', params as Record<string, string | number | boolean | undefined>);
  }

  async get(id: string): Promise<Lead> {
    return this.client.get<Lead>(`/leads/${encodeURIComponent(id)}`);
  }
}
