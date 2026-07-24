export type ZohoAnalyticsDataCenter = 'com' | 'eu' | 'in' | 'com.au' | 'jp' | 'ca' | 'sa';

export interface ZohoAnalyticsConfig {
  token: string;
  orgId: string;
  dataCenter?: ZohoAnalyticsDataCenter | string;
  baseUrl?: string;
}

export interface ZohoAnalyticsResponse {
  status?: string;
  summary?: string;
  message?: string;
  data?: unknown;
  [key: string]: unknown;
}

export class ZohoAnalyticsApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'ZohoAnalyticsApiError';
    this.statusCode = statusCode;
  }
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
