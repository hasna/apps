// ThoughtSpot Connector Types

export interface ConnectorConfig {
  apiKey?: string;
  token?: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty' | 'table';

export interface MetadataSearchRequest {
  metadata?: Array<{
    type?: string;
    identifier?: string;
    [key: string]: unknown;
  }>;
  include_details?: boolean;
  liveboard_response_version?: 'V1' | 'V2';
  record_offset?: number;
  record_size?: number;
  [key: string]: unknown;
}

export interface SearchDataRequest {
  query_string?: string;
  logical_table_identifier?: string;
  data_source_guid?: string;
  [key: string]: unknown;
}

export interface TmlImportRequest {
  import_policy?: 'ALL_OR_NONE' | 'PARTIAL_OBJECT';
  [key: string]: unknown;
}

export interface LogsFetchRequest {
  record_offset?: number;
  record_size?: number;
  [key: string]: unknown;
}

export interface RawRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
}

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
  resource?: string;
}

export class ConnectorApiError extends Error {
  readonly statusCode: number;
  readonly errors?: ApiErrorDetail[];
  readonly documentationUrl?: string;
  readonly requestId?: string;

  constructor(
    message: string,
    statusCode: number,
    options?: {
      errors?: ApiErrorDetail[];
      documentationUrl?: string;
      requestId?: string;
    },
  ) {
    super(message);
    this.name = 'ConnectorApiError';
    this.statusCode = statusCode;
    this.errors = options?.errors;
    this.documentationUrl = options?.documentationUrl;
    this.requestId = options?.requestId;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  getUserMessage(): string {
    if (this.errors?.length) {
      return this.errors.map((e) => e.message).join('; ');
    }
    return this.message;
  }
}

export function parseApiError(response: unknown, statusCode: number): ConnectorApiError {
  if (typeof response === 'string') {
    return new ConnectorApiError(response, statusCode);
  }

  if (!response || typeof response !== 'object') {
    return new ConnectorApiError(`HTTP ${statusCode} Error`, statusCode);
  }

  const data = response as Record<string, unknown>;
  const message =
    (data.message as string) ||
    (data.error as string) ||
    (data.error_description as string) ||
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

  return new ConnectorApiError(message, statusCode, {
    errors,
    documentationUrl: (data.documentation_url as string) || (data.docs_url as string),
    requestId: (data.request_id as string) || (data.requestId as string),
  });
}
