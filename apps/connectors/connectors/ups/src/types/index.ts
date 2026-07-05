export interface UPSConfig {
  apiKey: string;
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

export interface UPSShipment {
  id: string;
  status?: string;
  trackingNumber?: string;
  service?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface UPSShipmentList {
  shipments?: UPSShipment[];
  [key: string]: unknown;
}

export interface UPSEvent {
  id?: string;
  timestamp?: string;
  status?: string;
  description?: string;
  location?: string;
  [key: string]: unknown;
}

export interface UPSEventList {
  events?: UPSEvent[];
  [key: string]: unknown;
}

export interface UPSSearchResult {
  results?: unknown[];
  [key: string]: unknown;
}

export type UPSHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export class UPSApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'UPSApiError';
    this.statusCode = statusCode;
  }
}
