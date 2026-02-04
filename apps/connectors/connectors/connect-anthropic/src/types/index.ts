// Anthropic API Types

// ============================================
// Configuration
// ============================================

export interface AnthropicConfig {
  apiKey: string;
  baseUrl?: string;
}

// ============================================
// Models
// ============================================

export type AnthropicModel =
  | 'claude-opus-4-20250514'
  | 'claude-sonnet-4-20250514'
  | 'claude-3-5-haiku-20241022'
  | 'claude-3-5-sonnet-20241022'
  | 'claude-3-opus-20240229'
  | 'claude-3-sonnet-20240229'
  | 'claude-3-haiku-20240307';

export const ANTHROPIC_MODELS: AnthropicModel[] = [
  'claude-opus-4-20250514',
  'claude-sonnet-4-20250514',
  'claude-3-5-haiku-20241022',
  'claude-3-5-sonnet-20241022',
  'claude-3-opus-20240229',
  'claude-3-sonnet-20240229',
  'claude-3-haiku-20240307',
];

export const DEFAULT_MODEL: AnthropicModel = 'claude-sonnet-4-20250514';

// ============================================
// Messages API
// ============================================

export type MessageRole = 'user' | 'assistant';

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image';
  source: {
    type: 'base64';
    media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    data: string;
  };
}

export type ContentBlock = TextContent | ImageContent;

export interface Message {
  role: MessageRole;
  content: string | ContentBlock[];
}

export interface MessagesRequest {
  model: string;
  messages: Message[];
  max_tokens: number;
  system?: string;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  stream?: boolean;
  metadata?: {
    user_id?: string;
  };
}

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type ResponseContentBlock = TextBlock | ToolUseBlock;

export interface MessagesResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: ResponseContentBlock[];
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// ============================================
// Streaming Types
// ============================================

export interface MessageStartEvent {
  type: 'message_start';
  message: MessagesResponse;
}

export interface ContentBlockStartEvent {
  type: 'content_block_start';
  index: number;
  content_block: ResponseContentBlock;
}

export interface ContentBlockDeltaEvent {
  type: 'content_block_delta';
  index: number;
  delta: {
    type: 'text_delta';
    text: string;
  };
}

export interface ContentBlockStopEvent {
  type: 'content_block_stop';
  index: number;
}

export interface MessageDeltaEvent {
  type: 'message_delta';
  delta: {
    stop_reason: string;
    stop_sequence: string | null;
  };
  usage: {
    output_tokens: number;
  };
}

export interface MessageStopEvent {
  type: 'message_stop';
}

export type StreamEvent =
  | MessageStartEvent
  | ContentBlockStartEvent
  | ContentBlockDeltaEvent
  | ContentBlockStopEvent
  | MessageDeltaEvent
  | MessageStopEvent;

// ============================================
// Chat Options
// ============================================

export interface ChatOptions {
  model?: AnthropicModel | string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  systemPrompt?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  type: string;
  message: string;
}

export class AnthropicApiError extends Error {
  public readonly statusCode: number;
  public readonly error?: ApiErrorDetail;

  constructor(message: string, statusCode: number, error?: ApiErrorDetail) {
    super(message);
    this.name = 'AnthropicApiError';
    this.statusCode = statusCode;
    this.error = error;
  }
}
