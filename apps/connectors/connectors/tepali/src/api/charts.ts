import type { ConnectorClient } from './client';
import type { Chart, ChartCreateParams, ListResponse, ListParams } from '../types';

export class ChartsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams & { patient_id?: string }): Promise<ListResponse<Chart>> {
    return this.client.get<ListResponse<Chart>>('/charts', params as Record<string, string | number | boolean | undefined>);
  }

  async get(id: string): Promise<Chart> {
    return this.client.get<Chart>(`/charts/${encodeURIComponent(id)}`);
  }

  async create(params: ChartCreateParams): Promise<Chart> {
    return this.client.post<Chart>('/charts', params as unknown as Record<string, unknown>);
  }
}
