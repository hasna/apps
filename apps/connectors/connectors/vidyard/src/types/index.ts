export interface VidyardConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface VidyardVideo {
  id: number;
  name?: string;
  description?: string | null;
  status?: string | null;
  upload_url?: string;
  created_at?: number;
  updated_at?: number;
  [key: string]: unknown;
}

export interface VidyardEvent {
  id: number;
  name?: string;
  type?: string;
  created_at?: number;
  updated_at?: number;
  [key: string]: unknown;
}

export interface VidyardSearchParams {
  query?: string;
  page?: number;
  per_page?: number;
  [key: string]: string | number | boolean | undefined;
}

export interface VidyardRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
  retries?: number;
}

export class VidyardApiError extends Error {
  public readonly statusCode: number;
  public readonly responseBody?: string;

  constructor(message: string, statusCode: number, responseBody?: string) {
    super(message);
    this.name = 'VidyardApiError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }
}
