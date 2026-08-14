export interface TogetherApiPlatformConfig {
  apiKey: string;
  baseUrl?: string;
}

export type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

export class TogetherApiPlatformApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'TogetherApiPlatformApiError';
    this.statusCode = statusCode;
  }
}
