export type ZohoProjectsDataCenter = 'com' | 'eu' | 'in' | 'com.au' | 'jp' | 'ca' | 'sa';

export interface ZohoProjectsConfig {
  token: string;
  portalId?: string;
  dataCenter?: ZohoProjectsDataCenter | string;
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

export interface ZohoProjectsPortal {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface ZohoProjectsProject {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface ZohoProjectsTask {
  id: string;
  name: string;
  [key: string]: unknown;
}

export class ZohoProjectsApiError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'ZohoProjectsApiError';
    this.statusCode = statusCode;
  }
}
