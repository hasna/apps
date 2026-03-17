// Together AI Connector Types

export interface TogetherConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

// Chat Types
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop?: string[];
}

export interface ChatChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string;
}

export interface ChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// Embeddings Types
export interface EmbeddingRequest {
  model: string;
  input: string | string[];
}

export interface EmbeddingData {
  object: string;
  embedding: number[];
  index: number;
}

export interface EmbeddingResponse {
  object: string;
  data: EmbeddingData[];
  model: string;
  usage?: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

// Models Types
export interface TogetherModel {
  id: string;
  object: string;
  created: number;
  type: string;
  display_name?: string;
  context_length?: number;
}

export interface ModelsResponse {
  object: string;
  data: TogetherModel[];
}

// API Error
export class TogetherApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'TogetherApiError';
    this.statusCode = statusCode;
  }
}
