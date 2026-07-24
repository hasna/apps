import type { VidyardConfig, VidyardRequestOptions } from '../types';
import { VidyardApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://api.vidyard.com/dashboard/v1';

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export class VidyardClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: VidyardConfig) {
    if (!config.apiKey) {
      throw new Error('Vidyard API token is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  buildUrl(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    options: { includeAuth?: boolean } = {},
  ): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);
    const includeAuth = options.includeAuth ?? true;

    if (includeAuth) {
      url.searchParams.set('auth_token', this.apiKey);
    }

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, String(value));
        }
      }
    }

    return url.toString();
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    if (response.status === 204) {
      return {} as T;
    }

    const text = await response.text();
    if (!text) {
      return {} as T;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async request<T>(path: string, options: VidyardRequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, retries = 3 } = options;
    const hasBody = body !== undefined && Object.keys(body).length > 0;
    const useBodyAuth = ['POST', 'PUT', 'PATCH'].includes(method) && hasBody;

    let attempt = 0;
  let lastError: unknown;

    while (attempt <= retries) {
      try {
        const url = this.buildUrl(path, params, { includeAuth: !useBodyAuth });

        const headers: Record<string, string> = {
          Accept: 'application/json',
        };

        const fetchOptions: RequestInit = {
          method,
          headers,
        };

        if (useBodyAuth) {
          headers['Content-Type'] = 'application/json';
          fetchOptions.body = JSON.stringify({
            auth_token: this.apiKey,
            ...body,
          });
        } else if (hasBody && ['POST', 'PUT', 'PATCH'].includes(method)) {
          headers['Content-Type'] = 'application/json';
          fetchOptions.body = JSON.stringify(body);
        }

        const response = await fetch(url, fetchOptions);

        if (!response.ok) {
          const responseBody = await response.text();
          if (RETRYABLE_STATUSES.has(response.status) && attempt < retries) {
            attempt += 1;
            await this.sleep(Math.min(1000 * 2 ** attempt, 8000));
            continue;
          }

          let message = response.statusText || `HTTP ${response.status}`;
          try {
            const parsed = JSON.parse(responseBody) as { message?: string; error?: string };
            message = parsed.message || parsed.error || message;
          } catch {
            if (responseBody) {
              message = responseBody;
            }
          }

          throw new VidyardApiError(
            `Vidyard API ${method} ${path} failed: ${message}`,
            response.status,
            responseBody || undefined,
          );
        }

        return this.parseResponse<T>(response);
      } catch (error) {
        lastError = error;
        if (error instanceof VidyardApiError) {
          if (RETRYABLE_STATUSES.has(error.statusCode) && attempt < retries) {
            attempt += 1;
            await this.sleep(Math.min(1000 * 2 ** attempt, 8000));
            continue;
          }
          throw error;
        }

        if (attempt < retries) {
          attempt += 1;
          await this.sleep(Math.min(1000 * 2 ** attempt, 8000));
          continue;
        }

        throw error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Vidyard request failed');
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown>,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }
}
