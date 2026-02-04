// Mistral AI API Types

export interface MistralConfig {
  apiKey: string;
  baseUrl?: string;
}

// Models
export type MistralModel =
  | 'mistral-large-latest'
  | 'mistral-small-latest'
  | 'codestral-latest'
  | 'ministral-8b-latest'
  | 'ministral-3b-latest'
  | 'open-mistral-nemo'
  | 'pixtral-large-latest';

export type MistralEmbeddingModel = 'mistral-embed';

export const MISTRAL_MODELS: MistralModel[] = [
  'mistral-large-latest',
  'mistral-small-latest',
  'codestral-latest',
  'ministral-8b-latest',
  'ministral-3b-latest',
  'open-mistral-nemo',
  'pixtral-large-latest',
];

// Chat Completions
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: MessageRole;
  content: string | ContentPart[];
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface Tool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  stop?: string | string[];
  random_seed?: number;
  tools?: Tool[];
  tool_choice?: 'none' | 'auto' | 'any' | { type: 'function'; function: { name: string } };
  response_format?: { type: 'text' | 'json_object' };
  safe_prompt?: boolean;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'model_length' | null;
}

export interface ChatCompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: ChatCompletionUsage;
}

// Embeddings
export interface EmbeddingRequest {
  model: string;
  input: string | string[];
  encoding_format?: 'float';
}

export interface Embedding {
  object: 'embedding';
  index: number;
  embedding: number[];
}

export interface EmbeddingResponse {
  id: string;
  object: 'list';
  data: Embedding[];
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

// Models list
export interface Model {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
}

export interface ModelsResponse {
  object: 'list';
  data: Model[];
}

// Chat options for simplified API
export interface ChatOptions {
  model?: MistralModel | string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stop?: string | string[];
  responseFormat?: 'text' | 'json';
  systemPrompt?: string;
  tools?: Tool[];
  seed?: number;
  safePrompt?: boolean;
}

export interface EmbeddingOptions {
  model?: MistralEmbeddingModel | string;
}

export const DEFAULT_CHAT_MODEL: MistralModel = 'mistral-small-latest';
export const DEFAULT_EMBEDDING_MODEL: MistralEmbeddingModel = 'mistral-embed';

// Common types
export type OutputFormat = 'json' | 'pretty';

// API Error
export interface ApiErrorDetail {
  code: string;
  message: string;
  type?: string;
  param?: string;
}

export class MistralApiError extends Error {
  public readonly statusCode: number;
  public readonly error?: ApiErrorDetail;

  constructor(message: string, statusCode: number, error?: ApiErrorDetail) {
    super(message);
    this.name = 'MistralApiError';
    this.statusCode = statusCode;
    this.error = error;
  }
}
