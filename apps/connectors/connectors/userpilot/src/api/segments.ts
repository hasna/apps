import type { CreateSegmentOptions, ListSegmentsOptions } from '../types';
import type { UserpilotClient } from './client';

export class SegmentsApi {
  constructor(private readonly client: UserpilotClient) {}

  list(options: ListSegmentsOptions = {}): Promise<unknown> {
    return this.client.get('/segments', options);
  }

  get(id: string): Promise<unknown> {
    return this.client.get(`/segments/${encodeURIComponent(id)}`);
  }

  create(options: CreateSegmentOptions): Promise<unknown> {
    return this.client.post('/segments', options);
  }

  delete(id: string): Promise<unknown> {
    return this.client.delete(`/segments/${encodeURIComponent(id)}`);
  }
}
