// Type definitions for the Sucuri Scanning API connector

/**
 * Configuration for the Sucuri connector.
 */
export interface SucuriConfig {
  /** Scanning API key from the Sucuri monitor dashboard. */
  apiKey: string;
  /** Monitor domain shown in the Sucuri dashboard, for example monitorx.sucuri.net. */
  monitorDomain: string;
}

export type SucuriScanFormat = 'simple' | 'text' | 'serialized';

/** Parameters for requesting a Sucuri scan. */
export interface SucuriScanParams {
  /** Domain or URL to scan. */
  host: string;
  /** Output format accepted by the Scanning API. */
  format?: SucuriScanFormat;
}

/** Raw scan response plus request metadata. */
export interface SucuriScanResult {
  host: string;
  format: SucuriScanFormat;
  body: string;
}

/**
 * Error thrown when the Sucuri API returns a non-2xx response.
 */
export class SucuriApiError extends Error {
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(message: string, statusCode: number, details?: unknown) {
    super(message);
    this.name = 'SucuriApiError';
    this.statusCode = statusCode;
    this.details = details;
  }

  /** True when the failure is an authentication/authorization error. */
  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  /** True when the failure is a rate-limit error. */
  isRateLimited(): boolean {
    return this.statusCode === 429;
  }
}
