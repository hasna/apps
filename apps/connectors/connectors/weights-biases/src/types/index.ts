// Weights & Biases Connector Types

export interface WeightsBiasesConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface RunSummary {
  id: string;
  name?: string;
  displayName?: string;
  state?: string;
  entity?: string;
  project?: string;
  group?: string;
  jobType?: string;
  tags?: string[];
  createdAt?: string;
  heartbeatAt?: string;
  config?: Record<string, unknown>;
  summaryMetrics?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RunsListResponse {
  runs?: RunSummary[];
  data?: RunSummary[];
  nextPage?: string;
  [key: string]: unknown;
}

export interface CreateRunParams {
  entity?: string;
  project?: string;
  name?: string;
  displayName?: string;
  group?: string;
  jobType?: string;
  tags?: string[];
  config?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface EventRecord {
  id?: string;
  timestamp?: string;
  type?: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface EventsListResponse {
  events?: EventRecord[];
  data?: EventRecord[];
  [key: string]: unknown;
}

export interface SearchRequest {
  query?: string;
  entity?: string;
  project?: string;
  filters?: Record<string, unknown>;
  order?: string;
  perPage?: number;
  [key: string]: unknown;
}

export interface SearchResponse {
  results?: unknown[];
  data?: unknown[];
  [key: string]: unknown;
}

export interface ApiErrorDetail {
  code?: string;
  message: string;
  field?: string;
}

export class WeightsBiasesApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'WeightsBiasesApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
