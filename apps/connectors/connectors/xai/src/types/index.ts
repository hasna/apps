// xAI Grok API Types

// ============================================
// Configuration
// ============================================

export interface XAIConfig {
  apiKey: string;
  baseUrl?: string;
}

// ============================================
// Models
// ============================================

export type XAIModel =
  // Grok 4 series (2025-2026, latest)
  | 'grok-4-0709'       // current flagship
  | 'grok-4'
  | 'grok-4-fast'
  // Grok 4.1 (reasoning variants)
  | 'grok-4-1-fast-reasoning'
  | 'grok-4-1-fast-non-reasoning'
  // Grok 3 series
  | 'grok-3'
  | 'grok-3-fast'
  | 'grok-3-mini'
  // Grok 2 (legacy)
  | 'grok-2-vision'
  | 'grok-2-image';

export const XAI_MODELS: XAIModel[] = [
  'grok-4-0709',
  'grok-4',
  'grok-4-fast',
  'grok-4-1-fast-reasoning',
  'grok-4-1-fast-non-reasoning',
  'grok-3',
  'grok-3-fast',
  'grok-3-mini',
  'grok-2-vision',
  'grok-2-image',
];

export const DEFAULT_CHAT_MODEL: XAIModel = 'grok-4-0709';

// ============================================
// Chat Completions
// ============================================

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

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

export interface ChatMessage {
  role: MessageRole;
  content: string | ContentPart[];
  name?: string;
  tool_calls?: ToolCall[];
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
  tools?: Tool[];
  tool_choice?: 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } };
  response_format?: { type: 'text' | 'json_object' };
  seed?: number;
  user?: string;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
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
  system_fingerprint?: string;
}

// ============================================
// Chat Options (simplified API)
// ============================================

export interface ChatOptions {
  model?: XAIModel | string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stop?: string | string[];
  presencePenalty?: number;
  frequencyPenalty?: number;
  responseFormat?: 'text' | 'json';
  systemPrompt?: string;
  tools?: Tool[];
  seed?: number;
}

// ============================================
// Models list
// ============================================

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
  type?: string;
  param?: string;
}

export class XAIApiError extends Error {
  public readonly statusCode: number;
  public readonly error?: ApiErrorDetail;

  constructor(message: string, statusCode: number, error?: ApiErrorDetail) {
    super(message);
    this.name = 'XAIApiError';
    this.statusCode = statusCode;
    this.error = error;
  }
}
