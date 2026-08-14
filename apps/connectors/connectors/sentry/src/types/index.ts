// Sentry Connector Types

// ============================================
// Configuration
// ============================================

export interface SentryConfig {
  apiKey: string;      // Auth token or API key
  apiSecret?: string;  // Optional
  baseUrl?: string;    // Override default base URL (for self-hosted)
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface PaginatedResponse<T> {
  data: T[];
  nextToken?: string;
  hasMore: boolean;
}

// ============================================
// Example Resource Types
// ============================================

// Replace with Sentry API resource types
export interface ExampleResource {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  // Add more fields as needed
}

export interface ExampleListResponse {
  items: ExampleResource[];
  nextPageToken?: string;
  total?: number;
}

export interface ExampleCreateParams {
  name: string;
  // Add more params as needed
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class SentryApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'SentryApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
