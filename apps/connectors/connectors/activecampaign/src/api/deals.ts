import type { ConnectorClient } from './client';
import type { Deal, DealCreateParams, DealUpdateParams, ListParams } from '../types';

export class DealsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<unknown> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.limit) queryParams.limit = params.limit;
    if (params?.offset) queryParams.offset = params.offset;
    if (params?.filters) {
      for (const [key, value] of Object.entries(params.filters)) {
        queryParams[key] = value;
      }
    }
    return this.client.get<unknown>('/deals', queryParams);
  }

  async get(dealId: string): Promise<{ deal: Deal }> {
    return this.client.get<{ deal: Deal }>(`/deals/${dealId}`);
  }

  async create(params: DealCreateParams): Promise<{ deal: Deal }> {
    return this.client.post<{ deal: Deal }>('/deals', { deal: params });
  }

  async update(dealId: string, params: DealUpdateParams): Promise<{ deal: Deal }> {
    return this.client.put<{ deal: Deal }>(`/deals/${dealId}`, { deal: params });
  }

  async delete(dealId: string): Promise<void> {
    await this.client.delete(`/deals/${dealId}`);
  }

  async listNotes(dealId: string): Promise<unknown> {
    return this.client.get<unknown>(`/deals/${dealId}/notes`);
  }

  async createNote(dealId: string, note: string): Promise<unknown> {
    return this.client.post<unknown>(`/deals/${dealId}/notes`, { note: { note } });
  }

  async listStages(): Promise<unknown> {
    return this.client.get<unknown>('/dealStages');
  }

  async getStage(stageId: string): Promise<unknown> {
    return this.client.get<unknown>(`/dealStages/${stageId}`);
  }

  async listPipelines(): Promise<unknown> {
    return this.client.get<unknown>('/dealGroups');
  }

  async getPipeline(pipelineId: string): Promise<unknown> {
    return this.client.get<unknown>(`/dealGroups/${pipelineId}`);
  }
}
