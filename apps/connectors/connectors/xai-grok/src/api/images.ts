import type { XAIGrokClient } from './client';

export class ImagesApi {
  constructor(private readonly client: XAIGrokClient) {}

  generate(body: Record<string, unknown>): Promise<unknown> {
    return this.client.post('/images/generations', body);
  }

  get(generationId: string): Promise<unknown> {
    return this.client.get(`/images/generations/${encodeURIComponent(generationId)}`);
  }
}
