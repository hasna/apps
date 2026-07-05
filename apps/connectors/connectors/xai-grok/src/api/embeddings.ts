import type { XAIGrokClient } from './client';

export interface CreateEmbeddingOptions {
  model: string;
  input: unknown;
  dimensions?: number;
  encoding_format?: string;
}

export class EmbeddingsApi {
  constructor(private readonly client: XAIGrokClient) {}

  create(options: CreateEmbeddingOptions): Promise<unknown> {
    return this.client.post('/embeddings', { ...options });
  }
}
