export interface TestRigorConfig {
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

export interface TestRigorSuite {
  id: string;
  name?: string;
  [key: string]: unknown;
}

export interface TestRigorEvent {
  id?: string;
  type?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface TestRigorSearchResult {
  [key: string]: unknown;
}

export class TestRigorApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'TestRigorApiError';
    this.statusCode = statusCode;
  }
}
