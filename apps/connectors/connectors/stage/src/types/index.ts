// Stage Connector Types

// ============================================
// Configuration
// ============================================

export interface StageConfig {
  apiKey: string;
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'table' | 'pretty';

/**
 * A paginated list envelope returned by list endpoints.
 * The API wraps collections in a `data` array with optional cursor metadata.
 */
export interface StageList<T> {
  data: T[];
  next_cursor?: string | null;
  has_more?: boolean;
  total?: number;
}

// ============================================
// Review Types
// ============================================

export interface Review {
  id: string;
  title: string;
  status?: string;
  summary?: string;
  author?: string;
  repository?: string;
  branch?: string;
  base_branch?: string;
  chapter_count?: number;
  comment_count?: number;
  url?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Chapter {
  id: string;
  review_id: string;
  title: string;
  summary?: string;
  order?: number;
  files?: string[];
  created_at?: string;
}

export interface ReviewComment {
  id: string;
  review_id: string;
  body: string;
  author?: string;
  path?: string;
  line?: number;
  resolved?: boolean;
  created_at?: string;
}

// ============================================
// Pull Request Types
// ============================================

export interface PullRequest {
  id: string;
  number?: number;
  title: string;
  status?: string;
  state?: string;
  author?: string;
  repository?: string;
  source_branch?: string;
  target_branch?: string;
  review_id?: string;
  url?: string;
  created_at?: string;
  updated_at?: string;
}

// ============================================
// API Error Types
// ============================================

export interface StageErrorBody {
  message?: string;
  error?: string | { message?: string };
  code?: string;
}

export class StageApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;
  public readonly description: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.name = 'StageApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.description = message;
  }
}
