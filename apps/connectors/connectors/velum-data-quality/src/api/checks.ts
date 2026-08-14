import type { ConnectorClient } from './client';
import type { Check, CheckListResponse, ListParams } from '../types';

export class ChecksApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<CheckListResponse> {
    return this.client.get<CheckListResponse>('/checks', params as Record<string, string | number>);
  }

  async create(body: Record<string, unknown>): Promise<Check> {
    return this.client.post<Check>('/checks', body);
  }

  async get(checkId: string): Promise<Check> {
    return this.client.get<Check>(`/checks/${encodeURIComponent(checkId)}`);
  }
}
