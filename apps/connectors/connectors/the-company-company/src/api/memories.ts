import type { ConnectorClient } from './client';
import type { ListParams, MemoryListResponse, MemoryResponse } from '../types';

export class MemoriesApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<MemoryListResponse> {
    return this.client.get<MemoryListResponse>('/memories', params as Record<string, string | number>);
  }

  async create(body: Record<string, unknown>): Promise<MemoryResponse> {
    return this.client.post<MemoryResponse>('/memories', body);
  }
}
