// Veriphone API Types — https://veriphone.io/docs

export interface VeriphoneConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface VerifyPhoneOptions {
  phone: string;
  defaultCountry?: string;
}

export interface VerifyPhoneSuccessResponse {
  status: 'success';
  phone: string;
  phone_valid: boolean;
  phone_type?: string;
  phone_region?: string;
  country?: string;
  country_code?: string;
  country_prefix?: string;
  international_number?: string;
  local_number?: string;
  e164?: string;
  carrier?: string;
}

export interface VerifyPhoneErrorResponse {
  status: 'error';
  code: number;
  type: string;
  message: string;
}

export type VerifyPhoneResponse = VerifyPhoneSuccessResponse | VerifyPhoneErrorResponse;

export class VeriphoneApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: number;
  public readonly type?: string;

  constructor(message: string, statusCode: number, code?: number, type?: string) {
    super(message);
    this.name = 'VeriphoneApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.type = type;
  }

  isAuthError(): boolean {
    return this.statusCode === 401;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }
}

export function parseVeriphoneError(data: unknown, statusCode: number): VeriphoneApiError {
  if (typeof data === 'object' && data !== null) {
    const body = data as VerifyPhoneErrorResponse;
    if (body.status === 'error' && body.message) {
      return new VeriphoneApiError(body.message, statusCode, body.code, body.type);
    }
    const message = (body as { message?: string }).message;
    if (message) {
      return new VeriphoneApiError(message, statusCode);
    }
  }
  return new VeriphoneApiError(`Request failed with status ${statusCode}`, statusCode);
}
