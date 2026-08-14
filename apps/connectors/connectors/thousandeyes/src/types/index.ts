// ThousandEyes Connector Types

export interface ThousandEyesConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface ThousandEyesTest {
  testId?: string;
  testName?: string;
  type?: string;
  enabled?: boolean;
  createdDate?: string;
  modifiedDate?: string;
  [key: string]: unknown;
}

export interface ThousandEyesEvent {
  id?: string;
  type?: string;
  date?: string;
  testId?: string;
  [key: string]: unknown;
}

export interface ThousandEyesErrorResponse {
  error?: string;
  message?: string;
  errors?: string[] | Array<{ message?: string }>;
}

export class ThousandEyesApiError extends Error {
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(message: string, statusCode: number, details?: unknown) {
    super(message);
    this.name = 'ThousandEyesApiError';
    this.statusCode = statusCode;
    this.details = details;
  }
}
