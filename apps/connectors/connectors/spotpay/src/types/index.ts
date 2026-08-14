// SpotPay Connector Types

export interface SpotPayConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export type SpotPayJson = Record<string, unknown>;

export class SpotPayApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.name = 'SpotPayApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}
