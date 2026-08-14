import type { Assistant, ListParams } from '../types';
import type { VapiClient } from './client';

function toQueryParams(params?: ListParams): Record<string, string | number | boolean | undefined> | undefined {
  if (!params) return undefined;
  return {
    limit: params.limit,
    createdAtGt: params.createdAtGt,
    createdAtLt: params.createdAtLt,
    updatedAtGt: params.updatedAtGt,
    updatedAtLt: params.updatedAtLt,
  };
}

export class AssistantsApi {
  constructor(private readonly client: VapiClient) {}

  async list(params?: ListParams): Promise<Assistant[]> {
    return this.client.get<Assistant[]>('/assistant', toQueryParams(params));
  }

  async get(assistantId: string): Promise<Assistant> {
    return this.client.get<Assistant>(`/assistant/${encodeURIComponent(assistantId)}`);
  }

  async create(body: Record<string, unknown>): Promise<Assistant> {
    return this.client.post<Assistant>('/assistant', body);
  }
}
