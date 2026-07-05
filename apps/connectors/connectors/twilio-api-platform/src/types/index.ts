export interface TwilioApiPlatformConfig {
  apiKey: string;
  baseUrl?: string;
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = Record<string, JsonValue>;

export type TwilioApiPlatformResponse = JsonValue;

export class TwilioApiPlatformApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'TwilioApiPlatformApiError';
    this.statusCode = statusCode;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }
}

export function parseApiError(response: unknown, statusCode: number): TwilioApiPlatformApiError {
  if (typeof response === 'string' && response.length > 0) {
    return new TwilioApiPlatformApiError(response, statusCode);
  }

  if (response && typeof response === 'object') {
    const data = response as Record<string, unknown>;
    const message =
      (data.message as string) ||
      (data.error as string) ||
      ((data.error as Record<string, unknown>)?.message as string) ||
      `HTTP ${statusCode} Error`;
    return new TwilioApiPlatformApiError(message, statusCode);
  }

  return new TwilioApiPlatformApiError(`HTTP ${statusCode} Error`, statusCode);
}
