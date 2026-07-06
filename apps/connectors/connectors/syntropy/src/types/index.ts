// Syntropy Connector Types

// ============================================
// Configuration
// ============================================

export interface ConnectorConfig {
  apiKey: string;
  /** Optional override for the API base URL. Defaults to https://api.syntropy.io/v1 */
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'table' | 'pretty';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

// ============================================
// Spec Types
// ============================================

export interface Spec {
  id: string;
  title: string;
  status: string;
  description?: string;
  repository?: string;
  created_at?: string;
  updated_at?: string;
}

export interface CreateSpecInput {
  title: string;
  prompt?: string;
  repository?: string;
}

export interface SpecListResult {
  specs: Spec[];
  stub: boolean;
}

export interface SpecResult {
  spec: Spec;
  stub: boolean;
}

// ============================================
// Build Types
// ============================================

export interface Build {
  id: string;
  spec_id: string;
  status: string;
  pull_request_url?: string;
  created_at?: string;
  updated_at?: string;
}

export interface BuildListResult {
  builds: Build[];
  stub: boolean;
}

export interface BuildResult {
  build: Build;
  stub: boolean;
}

// ============================================
// Pull Request Types
// ============================================

export interface PullRequest {
  id: string;
  build_id?: string;
  title: string;
  url: string;
  status: string;
  created_at?: string;
}

export interface PullRequestListResult {
  pull_requests: PullRequest[];
  stub: boolean;
}

// ============================================
// Task Types
// ============================================

export interface Task {
  id: string;
  spec_id?: string;
  title: string;
  status: string;
  created_at?: string;
}

export interface TaskListResult {
  tasks: Task[];
  stub: boolean;
}

// ============================================
// Raw Request Types
// ============================================

export interface RawResult {
  status: number;
  ok: boolean;
  data: unknown;
  stub: boolean;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
}

export class ConnectorApiError extends Error {
  public readonly statusCode: number;
  public readonly responseBody?: string;

  constructor(message: string, statusCode: number, responseBody?: string) {
    super(message);
    this.name = 'ConnectorApiError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}
