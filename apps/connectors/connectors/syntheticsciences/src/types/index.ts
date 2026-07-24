// Synthetic Sciences API Types

// ============================================
// Configuration
// ============================================

export interface SyntheticSciencesConfig {
  apiKey: string;
  baseUrl?: string;
}

// ============================================
// Common
// ============================================

export type OutputFormat = 'json' | 'table' | 'pretty';

export interface Paginated<T> {
  data: T[];
  next_cursor?: string | null;
  total?: number;
}

export interface ListParams {
  limit?: number;
  cursor?: string;
}

// ============================================
// Projects
// ============================================

export interface Project {
  id: string;
  name: string;
  description?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  [key: string]: unknown;
}

// ============================================
// Literature
// ============================================

export interface LiteratureSearchInput {
  query: string;
  limit?: number;
  [key: string]: unknown;
}

export interface LiteratureResult {
  id?: string;
  title?: string;
  authors?: string[];
  abstract?: string;
  url?: string;
  score?: number;
  [key: string]: unknown;
}

// ============================================
// Experiments
// ============================================

export interface Experiment {
  id: string;
  project_id?: string;
  hypothesis?: string;
  status?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface CreateExperimentInput {
  project_id: string;
  hypothesis: string;
  [key: string]: unknown;
}

// ============================================
// GPU Jobs
// ============================================

export interface GpuJob {
  id: string;
  status?: string;
  experiment_id?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface DispatchGpuJobInput {
  experiment_id?: string;
  command?: string;
  [key: string]: unknown;
}

// ============================================
// Drafts
// ============================================

export interface Draft {
  id: string;
  project_id?: string;
  title?: string;
  status?: string;
  created_at?: string;
  [key: string]: unknown;
}

// ============================================
// API Error
// ============================================

export interface ApiErrorDetail {
  type?: string;
  message?: string;
  code?: string;
}

export class SyntheticSciencesApiError extends Error {
  public readonly statusCode: number;
  public readonly detail?: ApiErrorDetail;

  constructor(message: string, statusCode: number, detail?: ApiErrorDetail) {
    super(message);
    this.name = 'SyntheticSciencesApiError';
    this.statusCode = statusCode;
    this.detail = detail;
  }
}
