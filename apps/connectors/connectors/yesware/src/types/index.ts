// Yesware Connector Types
// Sales email tracking, sequences, events, and search

export interface YeswareConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface YeswareSequence {
  id: string;
  name?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface YeswareEvent {
  id: string;
  type?: string;
  occurred_at?: string;
  recipient?: string;
  [key: string]: unknown;
}

export interface YeswareSearchRequest {
  query?: string;
  filters?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface YeswareSearchResponse {
  results?: unknown[];
  total?: number;
  [key: string]: unknown;
}

export interface CreateSequenceInput {
  name: string;
  [key: string]: unknown;
}

export class YeswareApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly category?: string
  ) {
    super(message);
    this.name = 'YeswareApiError';
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  getUserMessage(): string {
    if (this.isAuthError()) {
      return `Authentication failed: ${this.message}. Check your YESWARE_API_KEY.`;
    }
    if (this.isRateLimited()) {
      return `Rate limited: ${this.message}`;
    }
    return this.message;
  }
}
