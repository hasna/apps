export interface JinaAIConfig { apiKey: string; }

export interface JinaEmbedding { object: string; embedding: number[]; index: number; }
export interface JinaEmbeddingResponse { model: string; object: string; data: JinaEmbedding[]; usage: { total_tokens: number; prompt_tokens: number }; }
export interface JinaRerankResult { index: number; relevance_score: number; document: { text: string }; }
export interface JinaRerankResponse { model: string; results: JinaRerankResult[]; usage: { total_tokens: number }; }
export interface JinaReaderResult { data: { title: string; content: string; url: string; description: string }; }
export interface JinaClassifyResult { predictions: { label: string; score: number }[]; }

export class JinaAIApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'JinaAIApiError'; this.statusCode = statusCode; }
}
