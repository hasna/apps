export interface TypesenseConfig {
  host: string;
  apiKey: string;
}

export interface TypesenseHealth {
  ok: boolean;
}

export interface TypesenseCollection {
  name: string;
  num_documents?: number;
  fields?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface TypesenseSearchResult {
  found: number;
  hits: Array<{ document: Record<string, unknown>; highlight?: Record<string, unknown> }>;
  facet_counts?: unknown[];
  page?: number;
  out_of?: number;
  [key: string]: unknown;
}

export interface TypesenseApiKey {
  id: number;
  description?: string;
  actions: string[];
  collections: string[];
  expires_at?: number;
  value?: string;
}

export interface TypesenseAlias {
  name: string;
  collection_name: string;
}

export class TypesenseApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'TypesenseApiError';
    this.statusCode = statusCode;
  }
}

export function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Typesense: ${label} is required`);
  }
  return value.trim();
}

export function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Typesense: ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Typesense: ${label} must be a non-empty string array`);
  }
  return value.map((item, index) => requireString(item, `${label}[${index}]`));
}

export function requireRecordArray(value: unknown, label: string): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Typesense: ${label} must be a non-empty object array`);
  }
  return value.map((item, index) => requireRecord(item, `${label}[${index}]`));
}

export function requireInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Typesense: ${label} must be a positive integer`);
  }
  return value;
}
