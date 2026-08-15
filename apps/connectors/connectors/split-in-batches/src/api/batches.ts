import type { ConnectorClient } from './client';
import type { Batch, BatchListResponse } from '../types';

export class BatchesApi {
  constructor(private readonly client: ConnectorClient) {}

  list(params?: Record<string, string | number | boolean | undefined>): Promise<BatchListResponse> {
    return this.client.get<BatchListResponse>('/batches', params);
  }

  create(body: Record<string, unknown>): Promise<Batch> {
    return this.client.post<Batch>('/batches', body);
  }

  get(batchId: string): Promise<Batch> {
    const encodedId = this.client.encodePathSegment(batchId);
    return this.client.get<Batch>(`/batches/${encodedId}`);
  }
}
