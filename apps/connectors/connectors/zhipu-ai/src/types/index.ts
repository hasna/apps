// Zhipu AI API Types

export interface ZhipuAiConfig {
  apiKey: string;
  baseUrl?: string;
}

// Chat Types (OpenAI-compatible)
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  reasoning_content?: string;
  tool_calls?: unknown[];
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
  object?: string;
  request_id?: string;
  created: number;
  model: string;
  choices: ChatChoice[];
  web_search?: WebSearchResult[];
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
  search_query: string;
  search_engine?: 'search-prime';
  count?: number;
  search_domain_filter?: string;
  search_recency_filter?: 'oneDay' | 'oneWeek' | 'oneMonth' | 'oneYear' | 'noLimit';
  request_id?: string;
  user_id?: string;
  [key: string]: unknown;
}

export interface WebSearchResult {
  title: string;
  content: string;
  link: string;
  media?: string;
  icon?: string;
  refer?: string;
  publish_date?: string;
}

export interface SearchResponse {
  id?: string;
  created?: number;
  search_result?: WebSearchResult[];
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
