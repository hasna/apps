export interface TursoApiPlatformConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface TursoItem {
  id: string;
  [key: string]: unknown;
}

export interface TursoEvent {
  id?: string;
  type?: string;
  [key: string]: unknown;
}

export interface TursoSearchRequest {
  query?: string;
  [key: string]: unknown;
}

export interface TursoApiPlatformErrorResponse {
  error?: string;
  message?: string;
  code?: string;
}

export class TursoApiPlatformApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.name = 'TursoApiPlatformApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}
