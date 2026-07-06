export interface TypeformConfig {
  apiToken: string;
  baseUrl?: string;
}

export type TypeformMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type QueryValue = string | number | boolean | Array<string | number | boolean> | undefined;

export interface TypeformForm {
  id: string;
  title: string;
  type?: string;
  workspace?: { href: string };
  settings?: Record<string, unknown>;
  fields?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface TypeformFormsList {
  total_items: number;
  page_count: number;
  items: TypeformForm[];
}

export interface TypeformResponse {
  response_id?: string;
  landing_id: string;
  token: string;
  landed_at: string;
  submitted_at?: string;
  answers?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface TypeformResponsesList {
  total_items: number;
  page_count: number;
  items: TypeformResponse[];
}

export interface TypeformWebhook {
  id: string;
  form_id: string;
  tag: string;
  url: string;
  enabled: boolean;
  verify_ssl?: boolean;
  secret?: string;
}

export interface TypeformWorkspace {
  id: string;
  name: string;
  default?: boolean;
  shared?: boolean;
  account_id?: string;
}

export interface TypeformTheme {
  id: string;
  name: string;
  colors?: Record<string, unknown>;
  font?: string;
  [key: string]: unknown;
}

export interface TypeformImage {
  id: string;
  src: string;
  width?: number;
  height?: number;
  file_name?: string;
}

export interface TypeformPaginated<T> {
  total_items: number;
  page_count: number;
  items: T[];
}

export class TypeformApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.name = 'TypeformApiError';
    this.statusCode = statusCode;
    this.code = code;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }
}
