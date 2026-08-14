// Type definitions for the Stilta connector

export type OutputFormat = 'json' | 'table' | 'pretty';

export interface StiltaConfig {
  apiKey: string;
  baseUrl?: string;
}

/**
 * Error thrown when the Stilta API returns a non-2xx response.
 */
export class StiltaApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'StiltaApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// ============================================
// Patents
// ============================================

export interface Patent {
  patentId: string;
  title?: string;
  abstract?: string;
  assignee?: string;
  inventors?: string[];
  filingDate?: string;
  publicationDate?: string;
  grantDate?: string;
  status?: string;
  claims?: unknown[];
  classifications?: string[];
  [key: string]: unknown;
}

export interface PatentSearchParams {
  /** Free-text or structured query string. */
  query?: string;
  /** Maximum number of results to return. */
  limit?: number;
  /** Offset for pagination. */
  offset?: number;
  /** Additional filters passed through to the API. */
  filters?: Record<string, unknown>;
  /** Any extra fields accepted by the search endpoint. */
  [key: string]: unknown;
}

export interface PatentSearchResult {
  results?: Patent[];
  total?: number;
  limit?: number;
  offset?: number;
  [key: string]: unknown;
}

// ============================================
// Research Jobs
// ============================================

export type ResearchJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | string;

export interface ResearchJob {
  jobId: string;
  type?: string;
  status?: ResearchJobStatus;
  query?: string;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
  result?: unknown;
  [key: string]: unknown;
}

export interface CreateResearchJobParams {
  /** The type of research job to run (e.g. prior-art, freedom-to-operate). */
  type?: string;
  /** Query or subject for the research job. */
  query?: string;
  /** Additional parameters passed through to the API. */
  [key: string]: unknown;
}

export interface ResearchJobListResult {
  results?: ResearchJob[];
  total?: number;
  [key: string]: unknown;
}

// ============================================
// Raw requests
// ============================================

export interface RawRequestParams {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
}
