import type { XAIGrokClient } from './client';
import type { ListQuery } from '../types';

export class VideoApi {
  constructor(private readonly client: XAIGrokClient) {}

  generate(body: Record<string, unknown>): Promise<unknown> {
    return this.client.post('/video/generations', body);
  }

  get(generationId: string): Promise<unknown> {
    return this.client.get(`/video/generations/${encodeURIComponent(generationId)}`);
  }

  list(query: ListQuery = {}): Promise<unknown> {
    return this.client.get('/video/generations', query as Record<string, string | number | boolean | undefined>);
  }
}
