// RunPod API Types

export interface RunPodConfig {
  apiKey: string;
  baseUrl?: string;
}

// Serverless Job Types
export interface JobInput {
  [key: string]: unknown;
}

export interface RunJobRequest {
  input: JobInput;
  webhook?: string;
}

export interface Job {
  id: string;
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT';
  delayTime?: number;
  executionTime?: number;
  input?: JobInput;
  output?: unknown;
  error?: string;
}

export interface RunSyncResponse {
  id: string;
  status: string;
  delayTime?: number;
  executionTime?: number;
  output?: unknown;
  error?: string;
}

export interface RunAsyncResponse {
  id: string;
  status: string;
}

// Health Check Types
export interface HealthResponse {
  jobs: {
    completed: number;
    failed: number;
    inProgress: number;
    inQueue: number;
    retried: number;
  };
  workers: {
    idle: number;
    initializing: number;
    ready: number;
    running: number;
    throttled: number;
  };
}

// Error Types
export class RunPodApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly detail?: string
  ) {
    super(message);
    this.name = 'RunPodApiError';
  }
}
