import type { XAIGrokClient } from './client';
import type { ListQuery } from '../types';

export class BatchesApi {
  constructor(private readonly client: XAIGrokClient) {}

  create(body: Record<string, unknown>): Promise<unknown> {
    return this.client.post('/batches', body);
  }

  list(query: ListQuery = {}): Promise<unknown> {
    return this.client.get('/batches', query as Record<string, string | number | boolean | undefined>);
  }

  get(batchId: string): Promise<unknown> {
    return this.client.get(`/batches/${encodeURIComponent(batchId)}`);
  }

  cancel(batchId: string): Promise<unknown> {
    return this.client.post(`/batches/${encodeURIComponent(batchId)}/cancel`);
  }
}
