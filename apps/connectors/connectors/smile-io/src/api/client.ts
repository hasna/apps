import type { SmileConfig } from '../types';
import { SmileApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.smile.io/v1';

export type QueryValue = string | number | boolean | undefined | null;

export interface SmileRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  params?: Record<string, QueryValue>;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

/**
 * Low-level HTTP client for the Smile.io REST API.
 *
 * Authentication is a private API key sent as a Bearer token:
 *   Authorization: Bearer <apiKey>
 */
export class SmileClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: SmileConfig) {
    if (!config.apiKey) {
      throw new Error('Smile.io API key is required');
    }
    this.apiKey = config.apiKey;
    // Trim a trailing slash so `${baseUrl}${path}` stays well-formed.
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  /**
   * Perform an authenticated request against the Smile.io API.
   * `endpoint` is a path relative to the base URL (e.g. `/customers`).
   */
  async request<T>(endpoint: string, options: SmileRequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;

    const url = new URL(`${this.baseUrl}${endpoint}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      }
    }

    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      ...headers,
    };

    const init: RequestInit = { method, headers: requestHeaders };
    if (body !== undefined && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    const response = await fetch(url.toString(), init);

    // 204 No Content and empty bodies have nothing to parse.
    if (response.status === 204) {
      return {} as T;
    }

    const text = await response.text();
    let data: unknown = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text };
      }
    }

    if (!response.ok) {
      throw new SmileApiError(
        extractErrorMessage(data, response),
        response.status,
        (data as { errors?: unknown })?.errors,
      );
    }

    return data as T;
  }
}

/**
 * Smile.io error payloads vary in shape. Common forms:
 *   { "error": "Not found" }
 *   { "message": "..." }
 *   { "errors": { "field": ["is invalid"] } }
 *   { "errors": ["something went wrong"] }
 */
function extractErrorMessage(data: unknown, response: Response): string {
  const fallback = `Smile.io API error: ${response.status} ${response.statusText}`;
  if (typeof data !== 'object' || data === null) {
    return fallback;
  }

  const record = data as Record<string, unknown>;
  if (typeof record.error === 'string') return record.error;
  if (typeof record.message === 'string') return record.message;

  const { errors } = record;
  if (typeof errors === 'string') return errors;
  if (Array.isArray(errors)) return errors.map(String).join('; ');
  if (errors && typeof errors === 'object') {
    const parts = Object.entries(errors as Record<string, unknown>).map(([field, value]) => {
      const detail = Array.isArray(value) ? value.map(String).join(', ') : String(value);
      return `${field}: ${detail}`;
    });
    if (parts.length > 0) return parts.join('; ');
  }

  return fallback;
}
