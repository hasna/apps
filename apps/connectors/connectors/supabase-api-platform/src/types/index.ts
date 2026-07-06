export interface SupabaseApiPlatformConfig {
  accessToken: string;
  baseUrl?: string;
}

export type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

export class SupabaseApiPlatformApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'SupabaseApiPlatformApiError';
    this.statusCode = statusCode;
  }
}
