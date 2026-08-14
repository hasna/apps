// Replicate API Types

export interface ReplicateConfig {
  apiKey: string;
  baseUrl?: string;
}

// Model Types
export interface ReplicateModel {
  url: string;
  owner: string;
  name: string;
  description?: string;
  visibility: string;
  github_url?: string;
  paper_url?: string;
  license_url?: string;
  run_count?: number;
  cover_image_url?: string;
  default_example?: object;
  latest_version?: ModelVersion;
}

export interface ModelVersion {
  id: string;
  created_at: string;
  cog_version?: string;
  openapi_schema?: object;
}

export interface ModelsListResponse {
  results: ReplicateModel[];
  next?: string;
  previous?: string;
}

// Prediction Types
export interface PredictionInput {
  [key: string]: unknown;
}

export interface CreatePredictionRequest {
  version: string;
  input: PredictionInput;
  webhook?: string;
  webhook_events_filter?: string[];
}

export interface Prediction {
  id: string;
  version: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  input: PredictionInput;
  output?: unknown;
  error?: string;
  logs?: string;
  metrics?: {
    predict_time?: number;
  };
  created_at: string;
  started_at?: string;
  completed_at?: string;
  urls: {
    get: string;
    cancel: string;
  };
}

export interface PredictionsListResponse {
  results: Prediction[];
  next?: string;
  previous?: string;
}

// Error Types
export class ReplicateApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly detail?: string
  ) {
    super(message);
    this.name = 'ReplicateApiError';
  }
}
