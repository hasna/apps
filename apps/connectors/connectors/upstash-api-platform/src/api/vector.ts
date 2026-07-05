import type { UpstashApiPlatformClient } from './client';
import type { CreateIndexRequest, VectorIndex } from '../types';

export class VectorApi {
  constructor(private readonly client: UpstashApiPlatformClient) {}

  listIndices(): Promise<VectorIndex[]> {
    return this.client.get<VectorIndex[]>('/vector/index');
  }

  getIndex(id: string): Promise<VectorIndex> {
    return this.client.get<VectorIndex>(`/vector/index/${encodeURIComponent(id)}`);
  }

  createIndex(body: CreateIndexRequest): Promise<VectorIndex> {
    return this.client.post<VectorIndex>('/vector/index', body);
  }

  deleteIndex(id: string): Promise<string> {
    return this.client.delete<string>(`/vector/index/${encodeURIComponent(id)}`);
  }
}
