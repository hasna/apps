import type { Call, ListParams } from '../types';
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

export class CallsApi {
  constructor(private readonly client: VapiClient) {}

  async list(params?: ListParams): Promise<Call[]> {
    return this.client.get<Call[]>('/call', toQueryParams(params));
  }

  async create(body: Record<string, unknown>): Promise<Call> {
    return this.client.post<Call>('/call', body);
  }
}
