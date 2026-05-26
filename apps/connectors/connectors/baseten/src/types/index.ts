// Baseten API Types

export interface BasetenConfig {
  apiKey: string;
  baseUrl?: string;
}

// Model Types
export interface BasetenModel {
  id: string;
  name: string;
  created_at?: string;
  updated_at?: string;
  status?: string;
}

export interface ModelsResponse {
  models: BasetenModel[];
}

// Prediction Types
export interface PredictionRequest {
  model_id: string;
  input: Record<string, unknown>;
  version_id?: string;
}

export interface PredictionResponse {
  id: string;
  model_id: string;
  status: string;
  output?: unknown;
  created_at?: string;
  completed_at?: string;
}

// Deployment Types
export interface DeploymentStatus {
  id: string;
  model_id: string;
  status: string;
  created_at?: string;
}

// Error Types
export class BasetenApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'BasetenApiError';
  }
}
