export interface VeracodeConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface OAuth2Config {
  clientId: string;
  clientSecret: string;
}

export interface OAuth2Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tokenType?: string;
  scope?: string;
}

export interface VeracodeScan {
  scan_id?: string;
  id?: string;
  name?: string;
  status?: string;
  scan_type?: string;
  created?: string;
  modified?: string;
  [key: string]: unknown;
}

export interface VeracodeScanList {
  scans?: VeracodeScan[];
  _embedded?: { scans?: VeracodeScan[] };
  page?: { size?: number; total_elements?: number; total_pages?: number; number?: number };
  [key: string]: unknown;
}

export interface VeracodeEvent {
  event_id?: string;
  id?: string;
  event_type?: string;
  created?: string;
  [key: string]: unknown;
}

export interface VeracodeEventList {
  events?: VeracodeEvent[];
  _embedded?: { events?: VeracodeEvent[] };
  [key: string]: unknown;
}

export interface VeracodeSearchRequest {
  query?: string;
  filters?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface VeracodeSearchResult {
  results?: unknown[];
  total?: number;
  [key: string]: unknown;
}

export class VeracodeApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'VeracodeApiError';
    this.statusCode = statusCode;
  }
}
