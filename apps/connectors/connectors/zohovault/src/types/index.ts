export type ZohoVaultDataCenter = 'com' | 'eu' | 'in' | 'com.au' | 'jp' | 'ca' | 'sa';

export type ZohoVaultSharePermission = 'VIEW' | 'MODIFY' | 'MANAGE' | 'VIEW_AND_COPY';

export interface ZohoVaultConfig {
  token: string;
  dataCenter?: ZohoVaultDataCenter | string;
  baseUrl?: string;
}

export interface ZohoVaultSecret {
  secretid?: string;
  secretname?: string;
  [key: string]: unknown;
}

export interface ZohoVaultChamber {
  chamberid?: string;
  chambername?: string;
  [key: string]: unknown;
}

export interface ZohoVaultUser {
  userid?: string;
  username?: string;
  [key: string]: unknown;
}

export interface ZohoVaultGroup {
  groupid?: string;
  groupname?: string;
  [key: string]: unknown;
}

export interface ZohoVaultApiResponse {
  operation?: {
    result?: {
      status?: string;
      message?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  message?: string;
  [key: string]: unknown;
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
  accountsServer?: string;
  apiDomain?: string;
}

export class ZohoVaultApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.name = 'ZohoVaultApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}
