// Vercel AI Gateway Connector Types

export interface VercelAiGatewayConfig {
  apiKey: string;
  baseUrl?: string;
}

export type GatewayCompatibility = 'openai' | 'anthropic' | 'openresponses';

export type GatewayMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export type OutputFormat = 'json' | 'pretty';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'developer';
  content: string | unknown;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string | string[];
  stream?: boolean;
  [key: string]: unknown;
}

export interface ChatChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string | null;
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

export interface GatewayModel {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
}

export interface ModelsResponse {
  object: string;
  data: GatewayModel[];
}

export interface EmbeddingRequest {
  model: string;
  input: string | string[];
  dimensions?: number;
  encoding_format?: string;
  [key: string]: unknown;
}

export interface EmbeddingResponse {
  object: string;
  data: Array<{
    object: string;
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage?: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export interface ResponseRequest {
  model: string;
  input: unknown;
  stream?: boolean;
  [key: string]: unknown;
}

export interface AnthropicMessageRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens: number;
  system?: string | unknown;
  stream?: boolean;
  anthropic_version?: string;
  [key: string]: unknown;
}

export interface RawRequestOptions {
  path: string;
  method?: GatewayMethod;
  body?: Record<string, unknown>;
  query?: Record<string, string | number | boolean | undefined>;
  compatibility?: GatewayCompatibility;
  headers?: Record<string, string>;
}

export class VercelAiGatewayApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'VercelAiGatewayApiError';
    this.statusCode = statusCode;
  }
}
