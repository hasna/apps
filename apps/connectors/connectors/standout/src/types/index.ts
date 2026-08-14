// Standout API types

export interface StandoutConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface StandoutQueryParams {
  [key: string]: string | number | boolean | undefined;
}

export interface StandoutRawRequestOptions {
  method?: string;
  path: string;
  query?: StandoutQueryParams;
  body?: Record<string, unknown>;
}

export interface StandoutCandidate {
  id?: string;
  [key: string]: unknown;
}

export interface StandoutRole {
  id?: string;
  [key: string]: unknown;
}

export interface StandoutAssessment {
  id?: string;
  [key: string]: unknown;
}

export class StandoutApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'StandoutApiError';
  }
}
