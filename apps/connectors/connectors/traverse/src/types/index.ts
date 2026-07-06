// Traverse API Types

export interface TraverseConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface ApiErrorDetail {
  code?: string;
  message: string;
  field?: string;
}

export class TraverseApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'TraverseApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

/** Generic list response when API schema is not fully documented */
export interface ListResponse<T = Record<string, unknown>> {
  data?: T[];
  items?: T[];
  [key: string]: unknown;
}

export interface Environment extends Record<string, unknown> {
  id?: string;
  name?: string;
}

export interface Episode extends Record<string, unknown> {
  id?: string;
  environment_id?: string;
}

export interface Dataset extends Record<string, unknown> {
  id?: string;
  name?: string;
}

export interface JudgmentRequest {
  score?: number;
  feedback?: string;
  [key: string]: unknown;
}

export interface JudgmentResponse extends Record<string, unknown> {
  id?: string;
  episode_id?: string;
  score?: number;
}
