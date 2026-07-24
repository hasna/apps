// Zenserp API Types

export interface ZenserpConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export type SearchEngine = 'google' | 'bing' | 'yandex';

export type SearchDevice = 'desktop' | 'mobile' | 'tablet';

export type SearchType = 'isch' | 'map' | 'nws' | 'shop' | 'vid';

export interface SearchParams {
  q?: string;
  query?: string;
  engine?: SearchEngine;
  location?: string;
  hl?: string;
  gl?: string;
  device?: SearchDevice;
  num?: number;
  start?: number;
  tbm?: SearchType | string;
  image_url?: string;
  imageUrl?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
  resource?: string;
}

export class ZenserpApiError extends Error {
  readonly name = 'ZenserpApiError';
  readonly statusCode: number;
  readonly errors?: ApiErrorDetail[];
  readonly documentationUrl?: string;
  readonly requestId?: string;

  constructor(
    message: string,
    statusCode: number,
    options: {
      errors?: ApiErrorDetail[];
      documentationUrl?: string;
      requestId?: string;
    } = {}
  ) {
    super(message);
    this.statusCode = statusCode;
    this.errors = options.errors;
    this.documentationUrl = options.documentationUrl;
    this.requestId = options.requestId;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      statusCode: this.statusCode,
      errors: this.errors,
      documentationUrl: this.documentationUrl,
      requestId: this.requestId,
    };
  }
}

export function parseApiError(response: unknown, statusCode: number): ZenserpApiError {
  if (typeof response === 'string') {
    return new ZenserpApiError(response, statusCode);
  }

  if (!response || typeof response !== 'object') {
    return new ZenserpApiError(`HTTP ${statusCode} Error`, statusCode);
  }

  const data = response as Record<string, unknown>;

  const message =
    (data.message as string) ||
    (data.error as string) ||
    ((data.error as Record<string, unknown>)?.message as string) ||
    (data.error_description as string) ||
    (data.detail as string) ||
    `HTTP ${statusCode} Error`;

  let errors: ApiErrorDetail[] | undefined;
  if (Array.isArray(data.errors)) {
    errors = data.errors.map((e: Record<string, unknown>) => ({
      code: String(e.code || e.error || 'unknown'),
      message: String(e.message || e.description || 'Unknown error'),
      field: e.field as string,
      resource: e.resource as string,
    }));
  }

  return new ZenserpApiError(message, statusCode, {
    errors,
    documentationUrl:
      (data.documentation_url as string) ||
      (data.docs_url as string) ||
      (data.help_url as string),
    requestId:
      (data.request_id as string) ||
      (data.requestId as string) ||
      (data.trace_id as string),
  });
}

export type SearchResponse = Record<string, unknown>;
