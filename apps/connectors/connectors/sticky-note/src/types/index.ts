// StickyNote Connector Types

export interface StickyNoteConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface StickyNoteError {
  error?: string;
  message?: string;
  code?: string;
}

export class StickyNoteApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'StickyNoteApiError';
  }

  isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }

  isRateLimited(): boolean {
    return this.status === 429;
  }

  getUserMessage(): string {
    if (this.isAuthError()) {
      return 'Authentication failed. Check your API key.';
    }
    if (this.isRateLimited()) {
      return 'Rate limit exceeded. Try again later.';
    }
    return this.message;
  }
}

export interface Note {
  id: string;
  title?: string;
  content?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface CreateNoteInput {
  title?: string;
  content?: string;
  [key: string]: unknown;
}

export interface StickyNoteEvent {
  id: string;
  type?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface SearchInput {
  query?: string;
  [key: string]: unknown;
}

export interface RawRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[];
  headers?: Record<string, string>;
}
