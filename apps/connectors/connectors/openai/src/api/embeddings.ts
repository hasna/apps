import type { OpenAIClient } from './client';
import type {
  EmbeddingRequest,
  EmbeddingResponse,
  EmbeddingOptions,
  EmbeddingModel,
} from '../types';

/**
 * Embeddings API
 */
export class EmbeddingsApi {
  constructor(private readonly client: OpenAIClient) {}

  /**
   * Create embeddings for the given input
   */
  async create(
    input: string | string[],
    options: EmbeddingOptions = {}
  ): Promise<EmbeddingResponse> {
    const request: EmbeddingRequest = {
      model: options.model || 'text-embedding-3-small',
      input,
    };

    if (options.dimensions !== undefined) {
      request.dimensions = options.dimensions;
    }

    return this.client.post<EmbeddingResponse>('/embeddings', request);
  }

  /**
   * Create embedding for a single text and return just the vector
   */
  async embed(
    text: string,
    options: EmbeddingOptions = {}
  ): Promise<number[]> {
    const response = await this.create(text, options);
    return response.data[0].embedding;
  }

  /**
   * Create embeddings for multiple texts
   */
  async embedMany(
    texts: string[],
    options: EmbeddingOptions = {}
  ): Promise<number[][]> {
    const response = await this.create(texts, options);
    return response.data
      .sort((a, b) => a.index - b.index)
      .map(item => item.embedding);
  }
}
