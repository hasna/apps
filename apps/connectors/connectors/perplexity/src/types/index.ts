// Perplexity AI API Types

// ============================================
// Configuration
// ============================================

export interface PerplexityConfig {
  apiKey: string;
  baseUrl?: string;
}

// ============================================
// Models
// ============================================

export type PerplexityModel =
  | 'sonar'
  | 'sonar-pro'
  | 'sonar-reasoning'
  | 'sonar-reasoning-pro'
  | 'sonar-deep-research';

export const PERPLEXITY_MODELS: PerplexityModel[] = [
  'sonar',
  'sonar-pro',
  'sonar-reasoning',
  'sonar-reasoning-pro',
  'sonar-deep-research',
];

// ============================================
// Chat Completions
// ============================================

export type MessageRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: MessageRole;
  content: string;
}

export interface ChatCompletionRequest {
  model: PerplexityModel;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stream?: boolean;
  presence_penalty?: number;
  frequency_penalty?: number;
  search_domain_filter?: string[];
  return_images?: boolean;
  return_related_questions?: boolean;
  search_recency_filter?: 'month' | 'week' | 'day' | 'hour';
}

export interface SearchResult {
  title: string;
  url: string;
  date?: string;
  last_updated?: string;
  snippet: string;
  source: 'web' | string;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: 'stop' | 'length' | 'content_filter' | null;
}

export interface ChatCompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  citation_tokens?: number;
  num_search_queries?: number;
}

export interface ChatCompletionResponse {
  id: string;
  model: string;
  created: number;
  object: 'chat.completion';
  choices: ChatCompletionChoice[];
  usage: ChatCompletionUsage;
  citations?: string[];
  search_results?: SearchResult[];
}

// Streaming types
export interface ChatCompletionChunkDelta {
  role?: MessageRole;
  content?: string;
}

export interface ChatCompletionChunkChoice {
  index: number;
  delta: ChatCompletionChunkDelta;
  finish_reason: 'stop' | 'length' | 'content_filter' | null;
}

export interface ChatCompletionChunk {
  id: string;
  model: string;
  created: number;
  object: 'chat.completion.chunk';
  choices: ChatCompletionChunkChoice[];
  usage?: ChatCompletionUsage;
  citations?: string[];
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class PerplexityApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'PerplexityApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
