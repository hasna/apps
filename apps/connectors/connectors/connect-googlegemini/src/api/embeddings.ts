import type { GeminiClient } from './client';
import type {
  EmbeddingTaskType,
  EmbedContentRequest,
  EmbedContentResponse,
  BatchEmbedContentsRequest,
  BatchEmbedContentsResponse,
} from '../types';

export interface EmbeddingOptions {
  taskType?: EmbeddingTaskType;
  title?: string;
  outputDimensionality?: number;
}

/**
 * Embeddings API
 */
export class EmbeddingsApi {
  private readonly model = 'gemini-embedding-001';

  constructor(private client: GeminiClient) {}

  /**
   * Generate embedding for text
   */
  async embed(text: string, options?: EmbeddingOptions): Promise<number[]> {
    const request: EmbedContentRequest = {
      content: {
        parts: [{ text }],
      },
      taskType: options?.taskType,
      title: options?.title,
      outputDimensionality: options?.outputDimensionality,
    };

    const response = await this.client.post<EmbedContentResponse>(
      `/models/${this.model}:embedContent`,
      request
    );

    return response.embedding.values;
  }

  /**
   * Generate embeddings for multiple texts
   */
  async batchEmbed(
    texts: string[],
    options?: EmbeddingOptions
  ): Promise<number[][]> {
    const requests: EmbedContentRequest[] = texts.map((text) => ({
      content: {
        parts: [{ text }],
      },
      taskType: options?.taskType,
      title: options?.title,
      outputDimensionality: options?.outputDimensionality,
    }));

    const request: BatchEmbedContentsRequest = { requests };

    const response = await this.client.post<BatchEmbedContentsResponse>(
      `/models/${this.model}:batchEmbedContents`,
      request
    );

    return response.embeddings.map((e) => e.values);
  }

  /**
   * Calculate cosine similarity between two embeddings
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Embeddings must have the same dimension');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Find most similar text from a list
   */
  async findMostSimilar(
    query: string,
    candidates: string[],
    options?: EmbeddingOptions
  ): Promise<{ text: string; similarity: number; index: number }[]> {
    const queryEmbedding = await this.embed(query, {
      ...options,
      taskType: options?.taskType || 'RETRIEVAL_QUERY',
    });

    const candidateEmbeddings = await this.batchEmbed(candidates, {
      ...options,
      taskType: options?.taskType || 'RETRIEVAL_DOCUMENT',
    });

    const similarities = candidateEmbeddings.map((embedding, index) => ({
      text: candidates[index],
      similarity: this.cosineSimilarity(queryEmbedding, embedding),
      index,
    }));

    // Sort by similarity descending
    return similarities.sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Get available task types
   */
  getTaskTypes(): EmbeddingTaskType[] {
    return [
      'SEMANTIC_SIMILARITY',
      'CLASSIFICATION',
      'CLUSTERING',
      'RETRIEVAL_DOCUMENT',
      'RETRIEVAL_QUERY',
      'CODE_RETRIEVAL_QUERY',
      'QUESTION_ANSWERING',
      'FACT_VERIFICATION',
    ];
  }

  /**
   * Get recommended dimensions
   */
  getRecommendedDimensions(): number[] {
    return [768, 1536, 3072];
  }
}
