import type { SpongeConfig } from '../types';
import { SpongeApiError } from '../types';

// Public Sponge Agent Wallet API base URL
export const DEFAULT_BASE_URL = 'https://api.wallet.paysponge.com';

export type QueryValue = string | number | boolean | undefined | null;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, QueryValue>;
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * Fetch-based client for the public Sponge REST API.
 *
 * Authentication is a Bearer API key; an optional `Sponge-Version` header
 * can be supplied to pin a specific API revision. All request/response
 * bodies are JSON.
 */
export class SpongeClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly apiVersion?: string;

  constructor(config: SpongeConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
    // Normalize: strip any trailing slash so path concatenation stays clean.
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.apiVersion = config.apiVersion;
  }

  buildUrl(path: string, params?: Record<string, QueryValue>): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      }
    }
    return url.toString();
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;

    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Accept': 'application/json',
      ...headers,
    };

    if (this.apiVersion) {
      requestHeaders['Sponge-Version'] = this.apiVersion;
    }

    const fetchOptions: RequestInit = { method, headers: requestHeaders };

    const hasBody = body !== undefined && body !== null && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    if (hasBody) {
      requestHeaders['Content-Type'] = 'application/json';
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    if (response.status === 204) {
      return {} as T;
    }

    let data: unknown;
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();
    if (text && contentType.includes('application/json')) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    } else {
      data = text || undefined;
    }

    if (!response.ok) {
      const code = extractErrorCode(data);
      const message = extractErrorMessage(data) || `${response.status} ${response.statusText}`;
      throw new SpongeApiError(`Sponge API Error: ${message}`, response.status, code, data);
    }

    return data as T;
  }

  get<T>(path: string, params?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  post<T>(path: string, body?: unknown, params?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  put<T>(path: string, body?: unknown, params?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body, params });
  }

  delete<T>(path: string, params?: Record<string, QueryValue>, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params, body });
  }

  /** Masked preview of the API key for display/debugging. */
  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}

function extractErrorMessage(data: unknown): string | undefined {
  if (typeof data === 'string') return data;
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const candidate = obj.message ?? obj.error ?? obj.error_description ?? obj.detail;
    if (typeof candidate === 'string') return candidate;
    if (candidate && typeof candidate === 'object') return JSON.stringify(candidate);
    return JSON.stringify(obj);
  }
  return undefined;
}

function extractErrorCode(data: unknown): string | undefined {
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const code = obj.code ?? obj.error_code;
    if (typeof code === 'string') return code;
    if (typeof obj.error === 'string') return obj.error;
  }
  return undefined;
}

/**
 * Strip `undefined` values from a params/body object so optional fields are
 * omitted from the request rather than serialized as `undefined`.
 */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value;
  }
  return out as Partial<T>;
}
