export type StytchEnvironment = 'live' | 'test';

export interface StytchConfig {
  projectId: string;
  secret: string;
  environment?: StytchEnvironment;
}

export interface StytchUser {
  user_id: string;
  emails?: Array<{ email: string; email_id: string; verified: boolean }>;
  phone_numbers?: Array<{ phone_number: string; phone_id: string; verified: boolean }>;
  name?: { first_name?: string; middle_name?: string; last_name?: string };
  status?: string;
  created_at?: string;
  trusted_metadata?: Record<string, unknown>;
  untrusted_metadata?: Record<string, unknown>;
}

export interface StytchSearchResponse<T> {
  results: T[];
  results_metadata?: { next_cursor?: string; total?: number };
  request_id?: string;
  status_code?: number;
}

export interface StytchSession {
  session_id: string;
  user_id: string;
  started_at?: string;
  last_accessed_at?: string;
  expires_at?: string;
  attributes?: Record<string, unknown>;
}

export class StytchApiError extends Error {
  public readonly statusCode: number;
  public readonly errorType?: string;
  public readonly requestId?: string;

  constructor(message: string, statusCode: number, errorType?: string, requestId?: string) {
    super(message);
    this.name = 'StytchApiError';
    this.statusCode = statusCode;
    this.errorType = errorType;
    this.requestId = requestId;
  }
}
