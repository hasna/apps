// Jina AI Connector — Neural search, embeddings, and reader
import { JinaAIClient } from './client';
import type { JinaAIConfig, JinaEmbeddingResponse, JinaRerankResponse, JinaReaderResult, JinaClassifyResult } from '../types';
export { JinaAIClient } from './client';

export class JinaAI {
  private readonly client: JinaAIClient;
  constructor(config: JinaAIConfig) { this.client = new JinaAIClient(config); }
  static fromEnv(): JinaAI {
    const apiKey = process.env.JINA_API_KEY;
    if (!apiKey) throw new Error('JINA_API_KEY is required');
    return new JinaAI({ apiKey });
  }

  async embed(input: string | string[], options?: { model?: string; encoding_type?: string }): Promise<JinaEmbeddingResponse> {
    return this.client.request<JinaEmbeddingResponse>('/embeddings', { body: { input: Array.isArray(input) ? input : [input], model: options?.model || 'jina-embeddings-v3', encoding_type: options?.encoding_type } as Record<string, unknown> });
  }

  async rerank(query: string, documents: string[], options?: { model?: string; top_n?: number }): Promise<JinaRerankResponse> {
    return this.client.request<JinaRerankResponse>('/rerank', { body: { query, documents: documents.map(d => ({ text: d })), model: options?.model || 'jina-reranker-v2-base-multilingual', top_n: options?.top_n } as Record<string, unknown> });
  }

  async classify(input: string[], labels: string[], options?: { model?: string }): Promise<JinaClassifyResult> {
    return this.client.request<JinaClassifyResult>('/classify', { body: { input, labels, model: options?.model } as Record<string, unknown> });
  }

  async read(url: string): Promise<JinaReaderResult> {
    return this.client.readerRequest<JinaReaderResult>(url);
  }

  getClient(): JinaAIClient { return this.client; }
}
