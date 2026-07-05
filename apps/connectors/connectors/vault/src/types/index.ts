export interface VaultConfig {
  baseUrl: string;
  token: string;
  namespace?: string;
}

export interface VaultRequestOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | string[]>;
  namespace?: string;
  wrapTtl?: string;
}

export type VaultHttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'LIST';

export interface VaultHealthResponse {
  initialized?: boolean;
  sealed?: boolean;
  standby?: boolean;
  performance_standby?: boolean;
  replication_performance_mode?: string;
  replication_dr_mode?: string;
  server_time_utc?: number;
  version?: string;
}

export interface VaultKvReadResponse {
  data?: {
    data?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
}

export interface VaultTransitEncryptResponse {
  data?: {
    ciphertext?: string;
  };
}

export class VaultApiError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'VaultApiError';
    this.statusCode = statusCode;
  }
}
