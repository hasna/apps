export type ResponseFormat = 'json' | 'csv' | 'ndjson' | 'parquet' | 'prometheus';
export type DataSourceMode = 'create' | 'append' | 'replace';
export type DataSourceFormat = 'csv' | 'ndjson' | 'parquet';

export interface TinybirdConfig {
  apiToken: string;
  baseUrl?: string;
}

export interface OAuth2Config {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
}

export interface OAuth2Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tokenType?: string;
  scope?: string;
}

export interface PipeNode {
  name: string;
  sql: string;
  description?: string;
}

export interface TinybirdApiErrorBody {
  error?: string;
  message?: string;
}

export class TinybirdApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'TinybirdApiError';
    this.statusCode = statusCode;
  }
}
