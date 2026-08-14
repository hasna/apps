// xAI Grok API Types (full surface)

export interface XAIGrokConfig {
  apiKey: string;
  baseUrl?: string;
}

export type XAIModel =
  | 'grok-4-0709'
  | 'grok-4'
  | 'grok-4-fast'
  | 'grok-4-1-fast-reasoning'
  | 'grok-4-1-fast-non-reasoning'
  | 'grok-3'
  | 'grok-3-fast'
  | 'grok-3-mini'
  | 'grok-2-vision'
  | 'grok-2-image';

export const DEFAULT_CHAT_MODEL: XAIModel = 'grok-4-0709';

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: MessageRole;
  content: string | unknown;
  name?: string;
  tool_calls?: unknown[];
  tool_call_id?: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  stop?: string | string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  response_format?: { type: 'text' | 'json_object' };
  seed?: number;
  user?: string;
  [key: string]: unknown;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string | null;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface Model {
  id: string;
  object: string;
  created?: number;
  owned_by?: string;
}

export interface ModelsResponse {
  object: string;
  data: Model[];
}

export interface ListQuery {
  limit?: number;
  after?: string;
  purpose?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface ApiErrorDetail {
  code?: string;
  message: string;
  type?: string;
  param?: string;
}

export class XAIGrokApiError extends Error {
  public readonly statusCode: number;
  public readonly error?: ApiErrorDetail;

  constructor(message: string, statusCode: number, error?: ApiErrorDetail) {
    super(message);
    this.name = 'XAIGrokApiError';
    this.statusCode = statusCode;
    this.error = error;
  }
}
