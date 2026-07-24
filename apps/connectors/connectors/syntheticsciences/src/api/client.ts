import type { SyntheticSciencesConfig } from '../types';
import { SyntheticSciencesApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://api.syntheticsciences.ai/v1';

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 500;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  method?: HttpMethod;
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Thin authenticated REST client for the Synthetic Sciences API.
 * Uses Bearer token auth and a configurable base URL, with retry/backoff
 * on transient (429 / 5xx) responses.
 */
export class SyntheticSciencesClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: SyntheticSciencesConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  private buildUrl(path: string, params?: RequestOptions['params']): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      }
    }

    return url.toString();
  }

  /**
   * Make an authenticated request to the Synthetic Sciences API.
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;
    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      ...headers,
    };

    const hasBody = body !== undefined && ['POST', 'PUT', 'PATCH'].includes(method);
    if (hasBody) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const fetchOptions: RequestInit = { method, headers: requestHeaders };
    if (hasBody) {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, fetchOptions);
      } catch (err) {
        // Network error - retry with backoff
        lastError = err;
        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
          continue;
        }
        throw err;
      }

      if (RETRYABLE_STATUS.has(response.status) && attempt < MAX_RETRIES) {
        const retryAfter = Number(response.headers.get('retry-after'));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : RETRY_BASE_DELAY_MS * 2 ** attempt;
        await sleep(delay);
        continue;
      }

      return this.parseResponse<T>(response);
    }

    // Should be unreachable, but keeps the type checker happy.
    throw lastError instanceof Error ? lastError : new Error('Request failed');
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    if (response.status === 204) {
      return {} as T;
    }

    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();

    let data: unknown = text;
    if (text && contentType.includes('application/json')) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      const errorData = data as { error?: ApiErrorShape; message?: string } | undefined;
      const detail = normalizeErrorDetail(errorData);
      const message = detail?.message || response.statusText || `HTTP ${response.status}`;
      throw new SyntheticSciencesApiError(message, response.status, detail);
    }

    return data as T;
  }

  get<T>(path: string, params?: RequestOptions['params']): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  post<T>(path: string, body?: RequestOptions['body'], params?: RequestOptions['params']): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  /**
   * Get a masked preview of the API key (for display / debugging).
   */
  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}

interface ApiErrorShape {
  type?: string;
  message?: string;
  code?: string;
}

function normalizeErrorDetail(
  errorData: { error?: ApiErrorShape; message?: string } | undefined
): ApiErrorShape | undefined {
  if (!errorData) return undefined;
  if (errorData.error && typeof errorData.error === 'object') {
    return errorData.error;
  }
  if (errorData.message) {
    return { message: errorData.message };
  }
  return undefined;
}
