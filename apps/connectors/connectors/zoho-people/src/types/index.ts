export interface ZohoPeopleConfig {
  token: string;
  dataCenter?: string;
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

export interface ZohoPeopleRecord {
  [key: string]: unknown;
}

export interface ZohoPeopleResponse {
  response?: {
    status?: number | string;
    message?: string;
    errorMessage?: string;
    result?: unknown;
  };
  result?: unknown;
  errorCode?: string | number;
  errorMessage?: string;
  message?: string;
}

export class ZohoPeopleApiError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'ZohoPeopleApiError';
    this.statusCode = statusCode;
  }
}
