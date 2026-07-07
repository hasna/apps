import type { StitchConfig, StitchErrorDetail } from '../types';
import { StitchApiError } from '../types';

// Default base URL for the Stitch Connect API.
// See: https://www.stitchdata.com/docs/developers/stitch-connect/api
const DEFAULT_BASE_URL = 'https://api.stitchdata.com';
const DEFAULT_MAX_RETRIES = 3;

export type QueryParams = Record<string, string | number | boolean | undefined | null>;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  params?: QueryParams;
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * Stitch Connect API client.
 * Handles Bearer authentication, URL/query building, JSON parsing,
 * and retry-with-backoff on rate-limit (429) and transient 5xx responses.
 */
export class StitchClient {
  private readonly accessToken: string;
  private readonly clientId?: number;
  private readonly baseUrl: string;
  private readonly maxRetries: number;

  constructor(config: StitchConfig) {
    if (!config.accessToken) {
      throw new Error('A Stitch access token is required');
    }
    this.accessToken = config.accessToken;
    this.clientId = config.clientId;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  /** Build a fully-qualified URL from a path and optional query params. */
  buildUrl(path: string, params?: QueryParams): string {
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

  /** The configured Stitch client (account) id, if any. */
  getClientId(): number | undefined {
    return this.clientId;
  }

  /** A masked preview of the access token, for display/debugging. */
  getAccessTokenPreview(): string {
    if (this.accessToken.length > 8) {
      return `${this.accessToken.substring(0, 4)}...${this.accessToken.substring(this.accessToken.length - 4)}`;
    }
    return '***';
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Compute the backoff delay (ms) for a retry attempt, honoring Retry-After. */
  private getRetryDelay(attempt: number, retryAfter: string | null): number {
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (!Number.isNaN(seconds)) {
        return seconds * 1000;
      }
    }
    // Exponential backoff: 0.5s, 1s, 2s, ...
    return 500 * Math.pow(2, attempt);
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;
    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      Accept: 'application/json',
      ...headers,
    };

    const fetchOptions: RequestInit = { method, headers: requestHeaders };

    if (body !== undefined && ['POST', 'PUT', 'DELETE'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/json';
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, fetchOptions);
      } catch (err) {
        // Network error — retry with backoff, then surface if exhausted.
        lastError = err;
        if (attempt < this.maxRetries) {
          await this.sleep(this.getRetryDelay(attempt, null));
          continue;
        }
        throw new StitchApiError(
          `Network error requesting ${method} ${path}: ${(err as Error).message}`,
          0,
        );
      }

      // Retry on rate limiting and transient server errors.
      if ((response.status === 429 || response.status >= 500) && attempt < this.maxRetries) {
        await this.sleep(this.getRetryDelay(attempt, response.headers.get('retry-after')));
        continue;
      }

      return this.parseResponse<T>(response, method, path);
    }

    // Should be unreachable, but keep the type checker satisfied.
    throw new StitchApiError(
      `Request failed after ${this.maxRetries + 1} attempts: ${(lastError as Error)?.message ?? 'unknown error'}`,
      0,
    );
  }

  private async parseResponse<T>(response: Response, method: string, path: string): Promise<T> {
    if (response.status === 204) {
      return {} as T;
    }

    const text = await response.text();
    let data: unknown = text;

    if (text) {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json') || text.startsWith('{') || text.startsWith('[')) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
    }

    if (!response.ok) {
      let message = `Stitch API error: ${response.status} ${response.statusText}`;
      let code: string | undefined;
      let errors: StitchErrorDetail[] | undefined;

      if (data && typeof data === 'object') {
        const errData = data as Record<string, unknown>;
        if (Array.isArray(errData.errors)) {
          errors = errData.errors as StitchErrorDetail[];
        }
        code = (errData.type as string) || (errData.status as string) || undefined;
        message =
          (errData.message as string) ||
          (errData.error as string) ||
          (errors && errors[0]?.message) ||
          message;
      } else if (typeof data === 'string' && data) {
        message = data;
      }

      throw new StitchApiError(`${message} (${method} ${path})`, response.status, code, errors);
    }

    return data as T;
  }

  get<T>(path: string, params?: QueryParams): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  post<T>(path: string, body?: unknown, params?: QueryParams): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  put<T>(path: string, body?: unknown, params?: QueryParams): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body, params });
  }

  delete<T>(path: string, body?: unknown, params?: QueryParams): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', body, params });
  }
}
