import type { ConnectorClient } from './client';
import type { Opportunity, OpportunityCreateParams, ListParams, PaginatedResponse } from '../types';

export class OpportunitiesApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<PaginatedResponse<Opportunity>> {
    return this.client.get<PaginatedResponse<Opportunity>>('/v2/opportunities', params as Record<string, string | number | boolean | undefined>);
  }

  async get(id: number, fieldIds?: number[]): Promise<Opportunity> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (fieldIds?.length) {
      params.fieldIds = fieldIds.join(',');
    }
    return this.client.get<Opportunity>(`/v2/opportunities/${id}`, params);
  }

  async create(data: OpportunityCreateParams): Promise<Opportunity> {
    return this.client.post<Opportunity>('/v2/opportunities', data);
  }

  async update(id: number, data: Partial<OpportunityCreateParams>): Promise<Opportunity> {
    return this.client.patch<Opportunity>(`/v2/opportunities/${id}`, data);
  }

  async delete(id: number): Promise<void> {
    await this.client.delete(`/v2/opportunities/${id}`);
  }
}
