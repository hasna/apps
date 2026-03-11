// Mistral AI API Types

export interface MistralConfig {
  apiKey: string;
  baseUrl?: string;
}

// Models (2026)
export type MistralModel =
  // Latest aliases (always point to newest)
  | 'mistral-large-latest'     // → mistral-large-2512
  | 'mistral-medium-latest'    // → mistral-medium-2508
  | 'mistral-small-latest'
  | 'codestral-latest'         // → codestral-2508
  | 'magistral-medium-latest'  // → magistral-medium-2509
  | 'ministral-8b-latest'
  | 'ministral-3b-latest'
  | 'pixtral-large-latest'
  | 'devstral-latest'
  // Pinned versions (2025-2026)
  | 'mistral-large-2512'       // Mistral Large 3 (Dec 2025)
  | 'mistral-medium-2508'      // Mistral Medium 3.1 (Aug 2025)
  | 'mistral-medium-2505'      // Mistral Medium 3 (May 2025)
  | 'magistral-medium-2509'    // Magistral Medium 1.2 (Sep 2025, reasoning)
  | 'magistral-medium-2507'    // Magistral Medium 1.1
  | 'magistral-medium-2506'    // Magistral Medium 1.0
  | 'magistral-small-2509'     // Magistral Small 1.2
  | 'codestral-2508'           // Codestral (Jul 2025, 256K context)
  | 'codestral-2501'
  | 'devstral-medium-2507'     // Devstral (coding agents)
  | 'ministral-3b-2512'
  | 'ministral-8b-2512'
  | 'ministral-14b-2512'
  | 'ministral-3b-2410'
  | 'ministral-8b-2410'
  | 'open-mistral-nemo';

export type MistralEmbeddingModel = 'mistral-embed';

export type MistralOCRModel = 'mistral-ocr-2512' | 'mistral-ocr-2505';

export type MistralAudioModel = 'voxtral-mini-2602' | 'voxtral-mini-transcribe-realtime-2602' | 'voxtral-mini-2507';

export const MISTRAL_MODELS: MistralModel[] = [
  // Latest aliases
  'mistral-large-latest',
  'mistral-medium-latest',
  'mistral-small-latest',
  'codestral-latest',
  'magistral-medium-latest',
  'ministral-8b-latest',
  'ministral-3b-latest',
  'pixtral-large-latest',
  'devstral-latest',
  // Pinned versions
  'mistral-large-2512',
  'mistral-medium-2508',
  'magistral-medium-2509',
  'codestral-2508',
  'devstral-medium-2507',
  'ministral-14b-2512',
  'open-mistral-nemo',
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

export const DEFAULT_CHAT_MODEL: MistralModel = 'mistral-medium-latest';
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
