export type ZohoCampaignsDataCenter = 'com' | 'eu' | 'in' | 'com.au' | 'jp' | 'ca' | 'sa';

export interface ZohoCampaignsConfig {
  token: string;
  dataCenter?: ZohoCampaignsDataCenter | string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'table' | 'pretty';

export interface ZohoCampaignsResponse {
  status?: string;
  code?: string | number;
  message?: string;
  [key: string]: unknown;
}

export class ZohoCampaignsApiError extends Error {
  readonly statusCode: number;
  readonly code?: string | number;

  constructor(message: string, statusCode: number, code?: string | number) {
    super(message);
    this.name = 'ZohoCampaignsApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}
