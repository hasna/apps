import type { ConnectorClient } from './client';
import type { Treatment, TreatmentListParams, ListResponse } from '../types';

export class TreatmentsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: TreatmentListParams): Promise<ListResponse<Treatment>> {
    return this.client.get<ListResponse<Treatment>>('/treatments', params as Record<string, string | number | boolean | undefined>);
  }

  async get(id: string): Promise<Treatment> {
    return this.client.get<Treatment>(`/treatments/${encodeURIComponent(id)}`);
  }
}
