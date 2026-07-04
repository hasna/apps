// Zhipu AI API Types

export interface ZhipuAiConfig {
  apiKey: string;
  baseUrl?: string;
}

// Chat Types (OpenAI-compatible)
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  stream?: boolean;
}

export interface ChatChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatChoice[];
  usage?: ChatUsage;
}

// Models Types
export interface ZhipuAiModel {
  id: string;
  object: string;
  created?: number;
  owned_by?: string;
}

export interface ModelsResponse {
  object: string;
  data: ZhipuAiModel[];
}

// Search Types
export interface SearchRequest {
  query: string;
  [key: string]: unknown;
}

export interface SearchResponse {
  [key: string]: unknown;
}

// Events Types
export interface EventsResponse {
  object?: string;
  data?: unknown[];
  [key: string]: unknown;
}

// Error Types
export class ZhipuAiApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'ZhipuAiApiError';
  }
}
