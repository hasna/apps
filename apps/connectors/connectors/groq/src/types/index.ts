// Groq Connector Types

export interface GroqConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  stream?: boolean;
}

export interface ChatChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string;
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
    queue_time?: number;
    prompt_time?: number;
    completion_time?: number;
    total_time?: number;
  };
}

export interface GroqModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
  context_window?: number;
}

export interface ModelsResponse {
  object: string;
  data: GroqModel[];
}

export class GroqApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'GroqApiError';
    this.statusCode = statusCode;
  }
}
