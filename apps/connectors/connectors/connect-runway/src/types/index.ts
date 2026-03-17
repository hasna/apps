// Runway API Types

export interface RunwayConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface ImageToVideoRequest {
  model: string;
  promptImage: string;
  promptText?: string;
  seed?: number;
  duration?: number;
  ratio?: string;
}

export interface TextToVideoRequest {
  model: string;
  promptText: string;
  seed?: number;
  duration?: number;
  ratio?: string;
}

export interface VideoTask {
  id: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  createdAt: string;
  progress?: number;
  output?: string[];
  failure?: string;
  failureCode?: string;
}

export interface TaskResponse {
  id: string;
}

export interface TaskListResponse {
  tasks: VideoTask[];
}

export class RunwayApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'RunwayApiError';
  }
}
