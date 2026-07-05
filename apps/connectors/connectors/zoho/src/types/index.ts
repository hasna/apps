// Zoho CRM v8 Connector Types

export interface ZohoConfig {
  accessToken: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface ZohoRecord {
  id?: string;
  [key: string]: unknown;
}

export interface ZohoRecordList {
  data: ZohoRecord[];
  info?: {
    per_page: number;
    count: number;
    page: number;
    more_records: boolean;
  };
}

export interface ZohoCreateResponse {
  data: Array<{
    code: string;
    details: { id: string };
    message: string;
    status: string;
  }>;
}

export interface ZohoRawRequestOptions {
  method?: string;
  body?: Record<string, unknown> | unknown[];
  params?: Record<string, string | number | boolean | undefined>;
}

export class ZohoApiError extends Error {
  readonly statusCode: number;
  readonly code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.name = 'ZohoApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}
