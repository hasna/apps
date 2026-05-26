// Cohere Connector Types

export interface CohereConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

// Chat Types
export interface ChatMessage {
  role: 'USER' | 'CHATBOT' | 'SYSTEM';
  message: string;
}

export interface ChatRequest {
  model?: string;
  message: string;
  chat_history?: ChatMessage[];
  preamble?: string;
  temperature?: number;
  max_tokens?: number;
  k?: number;
  p?: number;
  stop_sequences?: string[];
}

export interface ChatResponse {
  text: string;
  generation_id?: string;
  chat_history?: ChatMessage[];
  finish_reason?: string;
  meta?: {
    api_version?: { version: string };
    billed_units?: { input_tokens?: number; output_tokens?: number };
  };
}

// Embed Types
export type EmbedInputType = 'search_document' | 'search_query' | 'classification' | 'clustering';

export interface EmbedRequest {
  model?: string;
  texts: string[];
  input_type?: EmbedInputType;
  truncate?: 'NONE' | 'START' | 'END';
}

export interface EmbedResponse {
  id: string;
  embeddings: number[][];
  texts: string[];
  meta?: {
    api_version?: { version: string };
    billed_units?: { input_tokens?: number };
  };
}

// Rerank Types
export interface RerankRequest {
  model?: string;
  query: string;
  documents: (string | { text: string })[];
  top_n?: number;
  return_documents?: boolean;
}

export interface RerankResult {
  index: number;
  relevance_score: number;
  document?: { text: string };
}

export interface RerankResponse {
  id: string;
  results: RerankResult[];
  meta?: {
    api_version?: { version: string };
    billed_units?: { search_units?: number };
  };
}

// Classify Types
export interface ClassifyExample {
  text: string;
  label: string;
}

export interface ClassifyRequest {
  model?: string;
  inputs: string[];
  examples: ClassifyExample[];
}

export interface Classification {
  id: string;
  input: string;
  prediction: string;
  confidence: number;
  labels: Record<string, { confidence: number }>;
}

export interface ClassifyResponse {
  id: string;
  classifications: Classification[];
  meta?: {
    api_version?: { version: string };
  };
}

// Models Types
export interface CohereModel {
  name: string;
  endpoints?: string[];
  finetuned?: boolean;
  context_length?: number;
}

export interface ModelsResponse {
  models: CohereModel[];
}

// API Error
export class CohereApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'CohereApiError';
    this.statusCode = statusCode;
  }
}
