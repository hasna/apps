// Terminus API Types — https://www.terminusapp.com/apidocs

export type AuthMode = 'basic' | 'bearer';

export interface ConnectorConfig {
  apiKey?: string;
  token?: string;
  baseUrl?: string;
  authMode?: AuthMode;
}

export type OutputFormat = 'json' | 'pretty';

export interface PaginationParams {
  page?: number;
  items?: number;
  [key: string]: string | number | boolean | undefined;
}

export interface PaginationMeta {
  page: number;
  has_more: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface Project {
  id: string;
  name: string;
}

export interface UtmValue {
  value: string;
  fields_map: FieldMapEntry[];
  parameter_format_id: number | null;
}

export interface FieldMapEntry {
  field_id?: number;
  field_name?: string;
  final_value?: string;
  input_value?: string;
  prefix?: string | null;
  suffix?: string | null;
}

export interface Link {
  id: number;
  url: string;
  long_url?: string;
  description?: string | null;
  campaign?: UtmValue | null;
  medium?: UtmValue | null;
  source?: UtmValue | null;
  content?: UtmValue | null;
  term?: UtmValue | null;
  custom_parameter_values?: CustomParameterValue[];
  info_field_values?: InfoFieldValue[];
  labels?: Array<{ name: string }>;
  short_url?: { clicks: number; url: string };
  created_at?: number;
  updated_at?: number;
  created_by?: { email: string } | null;
  created_by_api?: boolean;
  duplicate?: boolean;
}

export interface CustomParameterValue {
  value: string;
  active?: boolean;
  fields_map: FieldMapEntry[];
  parameter_format_id: number | null;
  custom_parameter?: { name: string };
}

export interface InfoFieldValue {
  value: string;
  active?: boolean;
  fields_map: FieldMapEntry[];
  parameter_format_id: number | null;
  info_field?: { name: string };
}

export interface LinkListParams extends PaginationParams {
  'created_at[gt]'?: number;
  'updated_at[gt]'?: number;
}

export interface ConventionInputField {
  field_id: number;
  input_value: string;
}

export interface LinkCreateParams {
  url: string;
  description?: string;
  label_names?: string[];
  short_url_key?: string;
  skip_url_validation?: boolean;
  skip_monitoring?: boolean;
  convention?: {
    id: number;
    input_fields: ConventionInputField[];
  };
  utm?: {
    campaign?: { tag: string };
    medium?: { tag: string };
    source?: { tag: string };
    content?: { tag: string };
    term?: { tag: string };
  };
  custom?: Record<string, { tag: string }>;
  info?: Record<string, { tag: string }>;
}

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class ConnectorApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, options?: { errors?: ApiErrorDetail[] }) {
    super(message);
    this.name = 'ConnectorApiError';
    this.statusCode = statusCode;
    this.errors = options?.errors;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  isNotFound(): boolean {
    return this.statusCode === 404;
  }

  getUserMessage(): string {
    switch (this.statusCode) {
      case 401:
        return 'Authentication failed. Check your Terminus API key.';
      case 403:
        return 'Access denied.';
      case 404:
        return 'Resource not found.';
      case 429:
        return 'Rate limit exceeded. Please wait and try again.';
      default:
        return this.message;
    }
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
    ((data.error as Record<string, unknown>)?.message as string) ||
    (data.detail as string) ||
    `HTTP ${statusCode} Error`;

  let errors: ApiErrorDetail[] | undefined;
  if (Array.isArray(data.errors)) {
    errors = data.errors.map((e: Record<string, unknown>) => ({
      code: String(e.code || e.error || 'unknown'),
      message: String(e.message || e.description || 'Unknown error'),
      field: e.field as string | undefined,
    }));
  }

  return new ConnectorApiError(message, statusCode, { errors });
}
