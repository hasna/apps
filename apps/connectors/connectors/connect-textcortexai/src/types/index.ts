export interface TextCortexConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface GenerationOptions {
  sourceText?: string;
  keywords?: string[];
  formality?: 'formal' | 'casual';
  maxTokens?: number;
  temperature?: number;
  n?: number;
}

export interface TextResult {
  id: string;
  text: string;
}

export interface GenerationResponse {
  status: string;
  data: { outputs: TextResult[] };
  message?: string;
}

export interface UserInfo {
  email: string;
  first_name: string;
  last_name: string;
  words_balance: number;
}

export class TextCortexApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'TextCortexApiError';
    this.statusCode = statusCode;
  }
}
